import jwt from 'jsonwebtoken';
import { tenantService } from '../services/tenantService.js';
import { tenantStorage } from '../config/prisma.js';

/**
 * Middleware to resolve the tenant from request headers, token, or body,
 * and bind the tenant's isolated PrismaClient to the current AsyncLocalStorage context.
 */
export const resolveTenant = async (req, res, next) => {
  try {
    // 1. Check header, query, or body
    let rawTenant =
      req.headers['x-tenant-id'] ||
      req.headers['x-company-code'] ||
      req.headers['x-tenant'] ||
      req.query?.tenant ||
      req.query?.tenantId ||
      req.body?.tenantId ||
      req.body?.tenantCode ||
      req.body?.companyCode;

    // 2. Decode from JWT token if Authorization header is present
    const authHeader = req.headers['authorization'];
    if ((!rawTenant || rawTenant === 'default') && authHeader) {
      const token = authHeader.split(' ')[1];
      if (token) {
        try {
          const decoded = jwt.decode(token);
          if (decoded?.tenantCode) {
            rawTenant = decoded.tenantCode;
          }
        } catch {
          // ignore decode failure
        }
      }
    }

    if (!rawTenant && req.user?.tenantCode) {
      rawTenant = req.user.tenantCode;
    }

    // 3. For login/auth requests where tenant is not provided or is 'default', attempt resolution via email
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

    // Default to 'default' if not explicitly provided
    const tenantCode = (rawTenant ? String(rawTenant) : 'default').trim().toLowerCase();

    const tenantClient = await tenantService.getTenantClient(tenantCode);

    req.tenantCode = tenantCode;
    req.prisma = tenantClient;

    // Run the rest of the request lifecycle within the tenant's storage scope
    tenantStorage.run({ tenantCode, client: tenantClient }, () => {
      next();
    });
  } catch (error) {
    console.error(`[TenantMiddleware] Resolution failed for path ${req.originalUrl}:`, error.message);
    return res.status(400).json({
      error: error.message || 'Unable to connect to company database.'
    });
  }
};
