/**
 * SkillBridge API Request Telemetry & Cancellation Middleware
 * - Logs method, route, HTTP status code, and duration (ms)
 * - Flags slow requests (> 5000ms) with [API:SLOW]
 * - Attaches an AbortController to req.abortController so downstream operations
 *   (Axios AI calls, DB queries) can cancel immediately if the client disconnects
 *   or times out, preventing Nginx 110 upstream timeout cascades.
 */

export function requestTelemetryMiddleware(req, res, next) {
  const start = Date.now();
  const abortController = new AbortController();
  req.abortController = abortController;

  // If client or reverse proxy disconnects before response finishes, abort active background operations.
  // Must listen on res.on('close') + !res.writableFinished (NOT req.on('close'), which fires as soon as req body is read).
  res.on('close', () => {
    if (!res.writableFinished) {
      abortController.abort(new Error('Client or proxy closed connection before response completed.'));
    }
  });

  res.on('finish', () => {
    const duration = Date.now() - start;
    const isSlow = duration > 5000;
    const status = res.statusCode;

    // Filter out static asset noise from telemetry if desired, or log all API routes
    if (req.originalUrl.startsWith('/api') || req.path.startsWith('/api')) {
      const tag = isSlow ? ' [API:SLOW]' : '';
      const logFn = isSlow ? console.warn : console.log;
      logFn(`[API:PERF] ${req.method} ${req.originalUrl || req.path} -> ${status} (${duration}ms)${tag}`);
    }
  });

  next();
}

/**
 * Creates a route-level timeout middleware with automatic fallback or clean 504 JSON.
 * Guarantees the backend responds before Nginx's upstream timeout (typically 60s) expires.
 */
export function createRouteTimeout(timeoutMs = 30000, fallbackMessage = 'The request took longer than expected. Please try again.') {
  return (req, res, next) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (req.abortController) {
        req.abortController.abort(new Error(`Route processing exceeded ${timeoutMs}ms limit.`));
      }
      if (!res.headersSent && !res.writableEnded) {
        console.warn(`[API:TIMEOUT] Route ${req.method} ${req.originalUrl || req.path} reached ${timeoutMs}ms safety limit.`);
        res.status(504).json({
          error: fallbackMessage,
          timeout: true,
          durationMs: timeoutMs
        });
      }
    }, timeoutMs);

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}

export default {
  requestTelemetryMiddleware,
  createRouteTimeout
};
