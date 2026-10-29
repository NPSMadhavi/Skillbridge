import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/jwtConfig.js';

export const requireSuperAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }

  if (!token) {
    return res.status(401).json({ error: 'Super Admin access token required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired Super Admin token.' });
    }

    if (decoded.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Super Admin privileges required.' });
    }

    req.superAdmin = decoded;
    next();
  });
};
