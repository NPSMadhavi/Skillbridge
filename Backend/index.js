import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
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
const PORT = process.env.PORT || 5000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Frontend production build
const frontendPath = path.join(__dirname, '..', 'Frontend', 'dist');

// ============================================================
// SECURITY HEADERS & REVERSE PROXY
// ============================================================

// Trust proxy for secure cookies and rate-limiting when behind reverse proxy (Nginx, Caddy, etc.)
app.set('trust proxy', 1);

// Configure Helmet for secure HTTP headers & HSTS
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: false, // Served by frontend or edge
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Force HTTPS in production environments
app.use((req, res, next) => {
  if (IS_PROD && !req.secure && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});

// ============================================================
// CORS & BODY PARSING
// ============================================================

// CORS origin whitelist
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server or same-origin requests (no origin header)
    if (!origin) return callback(null, true);
    if (!IS_PROD || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    return callback(new Error('Blocked by CORS policy: Origin not allowed.'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-company-code']
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

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  res.sendFile(path.join(frontendPath, 'index.html'));
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
  console.log('SKILLBRIDGE BACKEND STARTED');
  console.log(`Port: ${PORT}`);
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
  setInterval(() => {
    console.log('[Scheduler] Executing scheduled daily database backup...');
    runDailyBackup().catch((err) => console.error('[Scheduler] Automated backup error:', err.message));
  }, BACKUP_INTERVAL_MS);
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
