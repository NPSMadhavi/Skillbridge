import jwt from 'jsonwebtoken';
import { tenantService } from '../services/tenantService.js';
import { tenantStorage } from '../config/prisma.js';

/**
 * Middleware to resolve the tenant from request headers, token, or body,
 * and bind the tenant's isolated PrismaClient to the current AsyncLocalStorage context.
 */
export const resolveTenant = async (req, res, next) => {
  try {
    // 1. If an Authorization Bearer token is provided, inspect its cryptographically bound tenantCode
    let rawTenant = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const tokenStr = authHeader.split(' ')[1];
        if (tokenStr) {
          const decoded = jwt.decode(tokenStr);
          if (decoded && decoded.tenantCode) {
            rawTenant = decoded.tenantCode;
          }
        }
      } catch (tokenErr) {
        // Fall back to headers if token inspection encounters an error
      }
    }

    // 2. If not specified in the token, check request headers, query parameters, or body
    if (!rawTenant) {
      rawTenant =
        req.headers['x-tenant-id'] ||
        req.headers['x-company-code'] ||
        req.headers['x-tenant'] ||
        req.query?.tenant ||
        req.query?.tenantId ||
        req.body?.tenantId ||
        req.body?.tenantCode ||
        req.body?.companyCode;
    }

    // 3. Fallback to req.user if already populated
    if (!rawTenant && req.user?.tenantCode) {
      rawTenant = req.user.tenantCode;
    }

    // 4. For login/auth requests where tenant is not provided or is 'default', attempt resolution via email
    if ((!rawTenant || rawTenant === 'default') && req.body?.email) {
      try {
        const comp = await tenantService.findCompanyByAdminEmail(req.body.email);
        if (comp) {
          rawTenant = comp.code;
        }
      } catch (err) {
        // Fallback to default if lookup fails
      }
    }

    // Normalize tenant code (defaulting to 'default')
    let tenantCode = (rawTenant ? String(rawTenant) : 'default').trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(tenantCode)) { tenantCode = 'default'; }

    // Resolve tenant client with safe fallback to default tenant
    let tenantClient;
    let effectiveTenant = tenantCode;
    try {
      tenantClient = await tenantService.getTenantClient(tenantCode);
    } catch (clientErr) {
      console.warn(`[TenantMiddleware] Tenant '${tenantCode}' resolution failed, falling back to 'default':`, clientErr.message);
      tenantClient = await tenantService.getTenantClient('default');
      effectiveTenant = 'default';
    }

    req.tenantCode = effectiveTenant;
    req.prisma = tenantClient;

    // Run the rest of the request lifecycle within the tenant's storage scope
    tenantStorage.run({ tenantCode: effectiveTenant, client: tenantClient }, () => {
      next();
    });
  } catch (error) {
    console.error(`[TenantMiddleware] Resolution failed for path ${req.originalUrl}:`, error.message);
    return res.status(400).json({
      error: error.message || 'Unable to connect to company database.'
    });
  }
};

