/**
 * Rate limiters completely disabled per project configuration.
 * All rate limiter middlewares are no-op pass-throughs.
 */
export const authRateLimiter = (req, res, next) => next();
export const passwordResetLimiter = (req, res, next) => next();
export const generalApiLimiter = (req, res, next) => next();


