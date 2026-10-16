import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import coursesRoutes from './routes/courses.js';
import superAdminRoutes from './routes/superAdmin.js';
import { resolveTenant } from './middleware/tenantMiddleware.js';
import prisma from './config/prisma.js';
import masterPrisma from './config/masterPrisma.js';
import aiService from './services/aiService.js';
import { tenantService } from './services/tenantService.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Frontend production build
const frontendPath = path.join(__dirname, '..', 'Frontend', 'dist');

// ============================================================
// MIDDLEWARE
// ============================================================

// Enable CORS
app.use(cors());

// Parse JSON request bodies (supports large multi-slide documents)
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`
  );
  next();
});

// ============================================================
// DATABASE TEST
// ============================================================

// This checks the EXISTING SkillBridge PostgreSQL database.
// It does NOT create a database or modify any data.
async function checkDatabaseConnection() {
  try {
    await prisma.$connect();
    await tenantService.ensureDefaultCompany();

    console.log('========================================');
    console.log('DATABASE CONNECTION: SUCCESS');
    console.log('SkillBridge PostgreSQL database connected');
    console.log('========================================');

    // Read one existing user only to verify the User table.
    const userCount = await prisma.user.count();

    console.log(`Existing users in database: ${userCount}`);
    console.log('Database query test: SUCCESS');
    console.log('========================================');
  } catch (error) {
    console.error('========================================');
    console.error('DATABASE CONNECTION: FAILED');
    console.error('========================================');
    console.error('Database error:', error);
    console.error('Message:', error?.message);
    console.error('Code:', error?.code);
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

// ============================================================
// HEALTH CHECK
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
    console.error('Health check database error:', error);

    res.status(500).json({
      status: 'error',
      server: 'running',
      database: 'disconnected',
      error: error.message
    });
  }
});

// ============================================================
// DATABASE DEBUG ENDPOINT
// ============================================================

// Temporary endpoint for checking the existing database.
// Remove this endpoint after debugging if you don't need it.
app.get('/api/debug/database', async (req, res) => {
  try {
    const userCount = await prisma.user.count();

    res.json({
      success: true,
      database: 'connected',
      userCount
    });
  } catch (error) {
    console.error('Database debug error:', error);

    res.status(500).json({
      success: false,
      database: 'connection failed',
      error: error.message,
      code: error.code || null
    });
  }
});

// ============================================================
// REACT SPA FALLBACK
// ============================================================

// This allows routes such as:
// /login
// /admin
// /dashboard
// etc. to load index.html when refreshed.

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
// GLOBAL ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {
  console.error('========================================');
  console.error('UNHANDLED SERVER ERROR');
  console.error('========================================');
  console.error(err);
  console.error('========================================');

  res.status(500).json({
    error: err.message || 'An unhandled server error occurred.'
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

  // Check the existing database after the server starts.
  await checkDatabaseConnection();

  try {
    const health = await aiService.checkGatewayHealth();
    const gatewayUrl = aiService.getGatewayBaseUrl();
    console.log(`[LLM Gateway] Health OK at ${gatewayUrl} (model: ${health?.model || 'unknown'})`);
  } catch (e) {
    console.warn('[LLM Gateway] Health check failed. Tutor chat requires SKILLBRIDGE_LLM_GATEWAY_URL on port 8081.');
  }
});

// ============================================================
// GLOBAL UNCAUGHT ERROR PROTECTION
// ============================================================

process.on('uncaughtException', (err) => {
  console.error('[BACKEND:UNCAUGHT_EXCEPTION] Caught error without crashing server:', err?.message || err);
  if (err?.stack) {
    console.error(err.stack);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[BACKEND:UNHANDLED_REJECTION] Caught rejection without crashing server:', reason);
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Closing Prisma connection...');

  await prisma.$disconnect();

  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Closing Prisma connection...');

  await prisma.$disconnect();

  process.exit(0);
});