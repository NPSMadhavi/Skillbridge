import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import coursesRoutes from './routes/courses.js';
import ttsRoutes from './routes/tts.js';
import superAdminRoutes from './routes/superAdmin.js';
import assistantRoutes from './routes/assistantRoutes.js';
import voiceRoutes from './routes/voiceRoutes.js';
import {
  getGatewayBaseUrl,
  getPythonServiceUrl,
  getChatGatewayVarName,
  getPythonServiceVarName,
  getGatewayApiKey,
  getApiKeyVarName
} from './config/gateway.js';
import { resolveTenant } from './middleware/tenantMiddleware.js';
import { generalApiLimiter } from './middleware/rateLimiter.js';
import prisma from './config/prisma.js';
import masterPrisma from './config/masterPrisma.js';
import aiService from './services/aiService.js';
import { tenantService } from './services/tenantService.js';
import { ensureMasterDatabase } from './services/masterDatabaseService.js';
import { runDailyBackup } from './scripts/daily_backup.js';
import { runStartupDiagnostics } from './services/diagnosticService.js';
import { requestTelemetryMiddleware } from './middleware/requestTelemetry.js';

// Auto-detect development mode from npm script, runner, or flag
const isDevScript = process.env.npm_lifecycle_event === 'dev' || process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
if (isDevScript) {
  process.env.NODE_ENV = 'development';
}

// Load environment variables with resilient fallback paths
const isDevMode = process.env.NODE_ENV === 'development';
const candidateEnvDirs = [
  path.dirname(fileURLToPath(import.meta.url)),
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  process.cwd(),
  path.join(process.cwd(), 'Backend')
];

// In development mode, load .env.development first with override so dev settings take priority
if (isDevMode) {
  for (const envDir of candidateEnvDirs) {
    const devPath = path.join(envDir, '.env.development');
    if (fs.existsSync(devPath)) {
      dotenv.config({ path: devPath, override: true });
      break;
    }
  }
}

// Fallback to standard .env without overriding already active variables
for (const envDir of candidateEnvDirs) {
  const envPath = path.join(envDir, '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}
dotenv.config();

const app = express();

// ============================================================
// PORT & PASSENGER CONFIGURATION
// ============================================================
// Detect Phusion Passenger (Plesk/cPanel/Passenger Standalone)
if (typeof PhusionPassenger !== 'undefined') {
  PhusionPassenger.configure({ autoInstall: false });
}

// In Plesk Phusion Passenger, process.env.PORT is dynamically assigned by Passenger.
// If process.env.PORT is not set and PhusionPassenger is detected, listen on 'passenger'.
// Otherwise fall back to local development port 5000.
const PORT = process.env.PORT || (typeof PhusionPassenger !== 'undefined' ? 'passenger' : 5000);
const IS_PROD = process.env.NODE_ENV === 'production';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Frontend production build resolution (supports Plesk, root httpdocs, dist, public, or relative path)
const candidateFrontendPaths = [
  path.join(__dirname, '..', 'Frontend', 'dist'),
  path.join(__dirname, 'dist'),
  path.join(__dirname, 'public'),
  path.join(process.cwd(), 'Frontend', 'dist'),
  path.join(process.cwd(), 'dist'),
  path.join(process.cwd(), 'public')
];
const existingFrontendPaths = candidateFrontendPaths
  .filter(p => fs.existsSync(path.join(p, 'index.html')))
  .sort((a, b) => fs.statSync(path.join(b, 'index.html')).mtimeMs - fs.statSync(path.join(a, 'index.html')).mtimeMs);
const frontendPath = existingFrontendPaths[0] || candidateFrontendPaths[0];

// Serve compiled frontend static assets (JS chunks, CSS, icons, images)
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath, {
    maxAge: IS_PROD ? '1d' : 0,
    index: false
  }));
}

// ============================================================
// SECURITY HEADERS & REVERSE PROXY
// ============================================================

// Trust reverse proxy (Nginx front-proxy = 1 hop) for accurate client IP resolution and rate-limiting
app.set('trust proxy', 1);

// Configure Helmet for secure HTTP headers & HSTS
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: false, // Handled by edge / frontend meta tags
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Force HTTPS in production environments when not on internal/localhost network
app.use((req, res, next) => {
  const isHttps = req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    req.headers['x-forwarded-ssl'] === 'on';
  const host = req.headers.host || '';
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1');

  if (IS_PROD && !isHttps && !isLocal && host) {
    return res.redirect(301, `https://${host}${req.url}`);
  }
  next();
});

// ============================================================
// CORS & BODY PARSING
// ============================================================

// Allowed production and local origins
const ALLOWED_ORIGINS = [
  'https://brutallyhired.com',
  'https://www.brutallyhired.com',
  'http://localhost:5173',
  'http://localhost:5000',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5000'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      ALLOWED_ORIGINS.includes(origin) ||
      origin.endsWith('.brutallyhired.com') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      !IS_PROD
    ) {
      return callback(null, true);
    }
    return callback(new Error(`CORS origin "${origin}" not allowed by policy`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-company-code', 'x-admin-password', 'X-Requested-With', 'Accept', 'Origin']
}));
app.options('*', cors());

// Parse JSON request bodies (supports large multi-slide documents)
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Structured API response-time telemetry and cancellation handling
app.use(requestTelemetryMiddleware);

// General DoS and endpoint scraping protection
app.use('/api/', generalApiLimiter);

// ============================================================
// DATABASE CONNECTION TEST
// ============================================================

async function checkDatabaseConnection() {
  try {
    await prisma.$connect();
    await ensureMasterDatabase().catch(e => console.warn('[MasterDB] Initialization notice:', e.message));
    await tenantService.ensureDefaultCompany();

    console.log('========================================');
    console.log('DATABASE CONNECTION: SUCCESS');
    console.log('SkillBridge PostgreSQL database connected');
    console.log('========================================');

    const userCount = await prisma.user.count();
    console.log(`Active users count: ${userCount}`);
    console.log('========================================');
  } catch (error) {
    console.error('========================================');
    console.error('DATABASE CONNECTION: FAILED');
    console.error('========================================');
    if (!IS_PROD) {
      console.error('Database error:', error.message);
    } else {
      console.error('Could not connect to PostgreSQL. Check connection string.');
    }
    console.error('========================================');
  }
}

// ============================================================
// API ROUTES
// ============================================================

// Super Admin Control-Plane API (Manages companies & tenant databases)
app.use('/api/v1/super-admin', superAdminRoutes);

// Tenant-Isolated APIs (Dynamically scoped to the request's company database)
app.use('/api/v1/auth', resolveTenant, authRoutes);
app.use('/api/v1/admin', resolveTenant, adminRoutes);
app.use('/api/v1/courses', resolveTenant, coursesRoutes);
app.use('/api/v1/tts', ttsRoutes);

// Dynamic Voice Assistant & Dynamic Wake-Word APIs
app.use('/api/v1/assistant', resolveTenant, assistantRoutes);
app.use('/api/assistant', resolveTenant, assistantRoutes);
app.use('/api/v1/voice', resolveTenant, voiceRoutes);
app.use('/api/voice', resolveTenant, voiceRoutes);

// ============================================================
// HEALTH CHECK (Production-safe, no error leak)
// ============================================================

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const host = req.headers.host || '';
    const proto = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const computedAppUrl = process.env.APP_URL || (host ? `${proto}://${host}` : (IS_PROD ? 'https://brutallyhired.com/' : `http://localhost:${PORT}`));

    res.json({
      status: 'ok',
      server: 'running',
      database: 'connected',
      environment: process.env.NODE_ENV || (IS_PROD ? 'production' : 'development'),
      appUrl: computedAppUrl,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check database error:', error.message);

    res.status(500).json({
      status: 'error',
      server: 'running',
      database: 'disconnected'
    });
  }
});

// ============================================================
// REACT SPA FALLBACK
// ============================================================

// Express 5 (path-to-regexp v8) requires '/{*splat}', whereas Express 4 uses '*'
const isExpress5 = Boolean(
  (express.version && express.version.startsWith('5')) ||
  (express.application && !express.application.init)
);
const spaWildcard = isExpress5 ? '/{*splat}' : '*';

app.get(spaWildcard, (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  const indexPath = path.join(frontendPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  return res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>SkillBridge</title>
      </head>
      <body style="font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 60px 20px; color: #1e293b;">
        <h2>Backend Service is Running</h2>
        <p>API status: <a href="/api/health">/api/health</a></p>
        <p style="color: #64748b; font-size: 14px;">Frontend build was not found at: <code>${frontendPath}</code></p>
      </body>
    </html>
  `);
});

// ============================================================
// 404 HANDLER
// ============================================================

app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found.'
  });
});

// ============================================================
// GLOBAL ERROR HANDLER (Sanitizes errors in production)
// ============================================================

app.use((err, req, res, next) => {
  console.error('[UNHANDLED SERVER ERROR]', err.message || err);
  if (!IS_PROD && err.stack) {
    console.error(err.stack);
  }

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: IS_PROD
      ? (statusCode === 500 ? 'An unexpected server error occurred.' : (err.message || 'Error processing request.'))
      : (err.message || 'An unhandled server error occurred.')
  });
});

// ============================================================
// START SERVER
// ============================================================

function getUrlHost(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '(not set)';
  try {
    const trimmed = rawUrl.trim();
    const hasProtocol = /^https?:\/\//i.test(trimmed);
    const parsed = new URL(hasProtocol ? trimmed : `http://${trimmed}`);
    return parsed.host;
  } catch {
    return '(invalid url)';
  }
}

const server = app.listen(PORT, async () => {
  // Execute comprehensive startup diagnostics across all subsystems
  try {
    await runStartupDiagnostics({ port: PORT, isProduction: IS_PROD });
  } catch (diagErr) {
    console.warn('[Startup Diagnostics] Notice running diagnostics:', diagErr.message);
  }

  // Schedule automated daily database backup (every 24 hours)
  const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const backupTimer = setInterval(() => {
    console.log('[Scheduler] Executing scheduled daily database backup...');
    runDailyBackup().catch((err) => console.error('[Scheduler] Automated backup error:', err.message));
  }, BACKUP_INTERVAL_MS);
  if (typeof backupTimer.unref === 'function') {
    backupTimer.unref();
  }
});

server.on('error', (err) => {
  console.error('[SERVER LISTEN ERROR]', err.message || err);
  if (err.code === 'EADDRINUSE') {
    console.error(`[SERVER LISTEN ERROR] Port or socket ${PORT} is already in use.`);
  }
});

// Configure server socket timeouts for long-running AI course generation
server.timeout = 300000; // 300 seconds (matches Nginx proxy_read_timeout 300s)
server.keepAliveTimeout = 305000;
server.headersTimeout = 310000;

// ============================================================
// GLOBAL UNCAUGHT ERROR PROTECTION
// ============================================================

process.on('uncaughtException', (err) => {
  console.error('[BACKEND:UNCAUGHT_EXCEPTION]', err?.message || err);
  if (!IS_PROD && err?.stack) {
    console.error(err.stack);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[BACKEND:UNHANDLED_REJECTION]', reason);
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Closing Prisma connections...');
  await prisma.$disconnect();
  await masterPrisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Closing Prisma connections...');
  await prisma.$disconnect();
  await masterPrisma.$disconnect();
  process.exit(0);
});
