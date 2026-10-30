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
import { resolveTenant } from './middleware/tenantMiddleware.js';
import { generalApiLimiter } from './middleware/rateLimiter.js';
import prisma from './config/prisma.js';
import masterPrisma from './config/masterPrisma.js';
import aiService from './services/aiService.js';
import { tenantService } from './services/tenantService.js';
import { runDailyBackup } from './scripts/daily_backup.js';

// Load environment variables
dotenv.config();

const app = express();

// ============================================================
// PORT & PASSENGER CONFIGURATION
// ============================================================
// Support Phusion Passenger (Plesk/cPanel/Passenger Standalone) and standard PORT environment variable
if (typeof PhusionPassenger !== 'undefined') {
  PhusionPassenger.configure({ autoInstall: false });
}
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
const frontendPath = candidateFrontendPaths.find(p => fs.existsSync(path.join(p, 'index.html'))) || candidateFrontendPaths[0];

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

// Trust 1 hop (reverse proxy like Nginx/Passenger) for secure cookies and rate-limiting
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

// CORS origin whitelist (includes brutallyhired.com, configured frontend URLs, and local development)
const allowedOrigins = [
  'https://brutallyhired.com',
  'https://www.brutallyhired.com',
  'http://brutallyhired.com',
  'http://www.brutallyhired.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000'
];
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL.trim().replace(/\/+$/, ''));
}
if (process.env.CORS_ORIGIN) {
  process.env.CORS_ORIGIN.split(',').forEach(s => allowedOrigins.push(s.trim().replace(/\/+$/, '')));
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server or same-origin requests (no origin header)
    if (!origin) return callback(null, true);

    const cleanOrigin = origin.replace(/\/+$/, '');
    if (!IS_PROD || allowedOrigins.includes(cleanOrigin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }

    // Allow same-host origin requests
    try {
      const originHost = new URL(origin).host;
      if (originHost && originHost.includes('brutallyhired.com')) {
        return callback(null, true);
      }
    } catch (_) {}

    return callback(new Error('Blocked by CORS policy: Origin not allowed.'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-company-code', 'x-admin-password']
}));

// Parse JSON request bodies (supports large multi-slide documents)
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Request logging (sanitizes URLs, avoiding raw query params)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// General DoS and endpoint scraping protection
app.use('/api/', generalApiLimiter);

// ============================================================
// DATABASE CONNECTION TEST
// ============================================================

async function checkDatabaseConnection() {
  try {
    await prisma.$connect();
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

    res.json({
      status: 'ok',
      server: 'running',
      database: 'connected',
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
        <title>BrutallyHired / SkillBridge</title>
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

app.listen(PORT, async () => {
  console.log('========================================');
  console.log('SKILLBRIDGE / BRUTALLYHIRED BACKEND STARTED');
  console.log(`Port / Socket: ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log('========================================');

  await checkDatabaseConnection();

  try {
    const health = await aiService.checkGatewayHealth();
    const gatewayUrl = aiService.getGatewayBaseUrl();
    console.log(`[LLM Gateway] Health OK at ${gatewayUrl} (model: ${health?.model || 'unknown'})`);
  } catch (e) {
    console.warn('[LLM Gateway] Notice: Gateway health check on port 8081.');
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
