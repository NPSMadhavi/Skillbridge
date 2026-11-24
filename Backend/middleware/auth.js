import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/jwtConfig.js';

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.query && req.query.token && req.method === 'GET') {
    // Only permit query parameter tokens for GET requests (e.g. direct media downloads)
    token = String(req.query.token).trim();
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }

    // Tenant boundary integrity: Ensure user token tenant matches request tenant
    if (decoded && decoded.tenantCode && req.tenantCode) {
      const isSuperAdmin = decoded.role === 'SUPERADMIN' || decoded.role === 'SUPER_ADMIN';
      if (!isSuperAdmin && decoded.tenantCode.toLowerCase() !== req.tenantCode.toLowerCase()) {
        return res.status(403).json({
          error: `Forbidden: Tenant boundary violation. Authenticated user belongs to tenant '${decoded.tenantCode}', but request is bound to tenant '${req.tenantCode}'.`
        });
      }
    }

    req.user = decoded; // { id, email, role, tenantCode }
    next();
  });
};

export const optionalAuthenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.query && req.query.token && req.method === 'GET') {
    token = String(req.query.token).trim();
  }

  if (!token) {
    req.user = { id: 'guest-student', role: 'STUDENT', tenantCode: req.tenantCode || 'default' };
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      // Gracefully fall back to guest student context rather than blocking learning session
      req.user = { id: 'guest-student', role: 'STUDENT', tenantCode: req.tenantCode || 'default' };
    } else {
      req.user = decoded;
    }
    next();
  });
};

export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions.' });
    }
    next();
  };
};
