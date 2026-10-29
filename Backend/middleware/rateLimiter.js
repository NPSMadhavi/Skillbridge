import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for authentication endpoints:
 * - /api/v1/auth/login
 * - /api/v1/auth/face-login
 * - /api/v1/admin/login
 * - /api/v1/super-admin/auth/login
 * Max 10 attempts per 15 minutes per IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts from this network. Please try again after 15 minutes.'
  },
  skipSuccessfulRequests: false,
});

/**
 * Stricter limiter for password reset and initial password setup:
 * Max 5 attempts per 15 minutes per IP.
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many password reset attempts. Please wait 15 minutes before trying again.'
  }
});

/**
 * General API rate limiter for regular traffic protection against DoS/scraping:
 * Max 300 requests per 15 minutes per IP.
 */
export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please slow down and try again later.'
  }
});

