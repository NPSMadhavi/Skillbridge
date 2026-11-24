import jwt from 'jsonwebtoken';
import { tenantService } from '../services/tenantService.js';
import { tenantStorage } from '../config/prisma.js';
import { JWT_SECRET } from '../config/jwtConfig.js';

/**
 * Middleware to resolve the tenant securely from cryptographically verified tokens,
 * headers, or explicit request attributes, and bind the tenant's isolated PrismaClient
 * to the current AsyncLocalStorage context.
 *
 * Security Rules:
 * 1. Tokens must have their cryptographic signature verified before trusting tenant claims.
 * 2. Unverified token payloads are never trusted for tenant resolution.
 * 3. Never silently fall back to the 'default' tenant when a specific tenant resolution fails.
 * 4. Authenticated users cannot cross tenant boundaries.
 */
export const resolveTenant = async (req, res, next) => {
  try {
    let rawTenant = null;
    let verifiedUser = null;
    const authHeader = req.headers['authorization'];

    // 1. If an Authorization Bearer token is provided, verify its signature strictly
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const tokenStr = authHeader.slice(7).trim();
      if (tokenStr) {
        try {
          verifiedUser = jwt.verify(tokenStr, JWT_SECRET);
          if (verifiedUser && verifiedUser.tenantCode) {
            rawTenant = verifiedUser.tenantCode;
            req.user = verifiedUser; // Attach verified user early
          }
        } catch (tokenErr) {
          // Token signature failed or expired; do not trust unverified claims
          console.warn(`[TenantMiddleware] Bearer token verification failed: ${tokenErr.message}`);
        }
      }
    }

    // 2. If not specified via a verified token, check explicit headers, query parameters, or body
    const explicitHeaderTenant =
      req.headers['x-tenant-id'] ||
      req.headers['x-company-code'] ||
      req.headers['x-tenant'] ||
      req.query?.tenant ||
      req.query?.tenantId ||
      req.body?.tenantId ||
      req.body?.tenantCode ||
      req.body?.companyCode;

    // Security check: If user is authenticated with a token, ensure they cannot cross to another tenant
    if (verifiedUser && explicitHeaderTenant) {
      const normalizedExplicit = String(explicitHeaderTenant).trim().toLowerCase();
      const normalizedUserTenant = String(verifiedUser.tenantCode || '').trim().toLowerCase();

      // Superadmins are permitted cross-tenant access for administrative purposes
      const isSuperAdmin = verifiedUser.role === 'SUPERADMIN' || verifiedUser.role === 'SUPER_ADMIN';
      if (!isSuperAdmin && normalizedUserTenant && normalizedExplicit !== normalizedUserTenant) {
        return res.status(403).json({
          error: `Forbidden: Tenant boundary violation. You are authenticated for tenant '${normalizedUserTenant}' and cannot access '${normalizedExplicit}'.`
        });
      }
    }

    if (!rawTenant && explicitHeaderTenant) {
      rawTenant = explicitHeaderTenant;
    }

    // 3. Fallback to req.user if already populated by prior middleware
    if (!rawTenant && req.user?.tenantCode) {
      rawTenant = req.user.tenantCode;
    }

    // 4. For login/auth requests where tenant is not provided, attempt resolution via email in Master DB
    const isAuthRoute = req.path.includes('/login') || req.path.includes('/auth') || req.path.includes('/forgot-password');
    if (!rawTenant && isAuthRoute && req.body?.email) {
      try {
        const comp = await tenantService.findCompanyByAdminEmail(req.body.email);
        if (comp) {
          rawTenant = comp.code;
        }
      } catch (err) {
        // Continue to explicit tenant validation
      }
    }

    // If an explicit tenant was requested, validate its format
    const requestedExplicitTenant = Boolean(rawTenant);
    let tenantCode = (rawTenant ? String(rawTenant) : 'default').trim().toLowerCase();

    if (!/^[a-z0-9_-]{1,64}$/.test(tenantCode)) {
      if (requestedExplicitTenant) {
        return res.status(400).json({ error: 'Invalid tenant identifier format.' });
      }
      tenantCode = 'default';
    }

    // Resolve tenant database client
    let tenantClient;
    try {
      tenantClient = await tenantService.getTenantClient(tenantCode);
    } catch (clientErr) {
      // SECURITY RULE: Never silently fall back to 'default' if an explicit tenant was requested!
      if (requestedExplicitTenant && tenantCode !== 'default') {
        console.error(`[TenantMiddleware] Connection to requested tenant '${tenantCode}' failed:`, clientErr.message);
        return res.status(404).json({
          error: `Company organization '${tenantCode}' not found or database is unreachable.`
        });
      }

      // Only allow fallback to default if NO tenant was ever requested (e.g. public health/info routes)
      console.warn(`[TenantMiddleware] Default tenant resolution notice:`, clientErr.message);
      tenantClient = await tenantService.getTenantClient('default');
      tenantCode = 'default';
    }

    req.tenantCode = tenantCode;
    req.prisma = tenantClient;

    // Run the rest of the request lifecycle within the tenant's isolated storage scope
    tenantStorage.run({ tenantCode, client: tenantClient }, () => {
      next();
    });
  } catch (error) {
    console.error(`[TenantMiddleware] Resolution failed for path ${req.originalUrl}:`, error.message);
    return res.status(500).json({
      error: 'An internal error occurred during tenant resolution.'
    });
  }
};

