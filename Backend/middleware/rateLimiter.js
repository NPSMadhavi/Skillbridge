import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for authentication endpoints:
 * - /api/v1/auth/login
 * - /api/v1/auth/face-login
 * - /api/v1/admin/login
 * - /api/v1/super-admin/auth/login
 * Allows up to 100 failed attempts per 15 minutes per IP (configurable).
 * Successful logins are skipped and never count against the rate limit.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: () => {
    const custom = parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10);
    return Number.isFinite(custom) && custom > 0 ? custom : 100;
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  skipSuccessfulRequests: true, // Successful logins never count against rate limit quota
  skip: () => process.env.RATE_LIMIT_DISABLED === 'true' || process.env.AUTH_RATE_LIMIT_DISABLED === 'true',
  message: {
    error: 'Too many login attempts from this network. Please try again after 15 minutes.'
  },
});

/**
 * Stricter limiter for password reset and initial password setup:
 * Up to 25 attempts per 15 minutes per IP.
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => {
    const custom = parseInt(process.env.PASSWORD_RESET_RATE_LIMIT_MAX, 10);
    return Number.isFinite(custom) && custom > 0 ? custom : 25;
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  skipSuccessfulRequests: true,
  skip: () => process.env.RATE_LIMIT_DISABLED === 'true',
  message: {
    error: 'Too many password reset attempts. Please wait 15 minutes before trying again.'
  }
});

/**
 * General API rate limiter for regular traffic protection against DoS/scraping:
 * Up to 3,000 requests per 15 minutes per IP (accommodates audio/video streaming & slide polling).
 */
export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => {
    const custom = parseInt(process.env.GENERAL_RATE_LIMIT_MAX, 10);
    return Number.isFinite(custom) && custom > 0 ? custom : 3000;
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  skip: () => process.env.RATE_LIMIT_DISABLED === 'true',
  message: {
    error: 'Too many requests. Please slow down and try again later.'
  }
});

