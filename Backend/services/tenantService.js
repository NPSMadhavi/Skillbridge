import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import masterPrisma from '../config/masterPrisma.js';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read tenant schema SQL
const tenantSchemaSql = fs.readFileSync(path.join(__dirname, 'tenantSchema.sql'), 'utf-8');

// In-memory cache for tenant PrismaClient instances
const tenantClients = new Map();

/**
 * Extract base connection URL from DATABASE_URL or DB_BASE_URL
 */
function getDbBaseConfig() {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:praveen@localhost:5432/skillbridge?schema=public';
  // Parse postgresql://user:pass@host:port/dbname...
  const urlObj = new URL(dbUrl);
  const baseUrl = `${urlObj.protocol}//${urlObj.username ? `${urlObj.username}:${urlObj.password}@` : ''}${urlObj.host}`;
  const rootUrl = `${baseUrl}/postgres`;
  return { baseUrl, rootUrl, defaultDbName: urlObj.pathname.replace(/^\//, '').split('?')[0] || 'skillbridge' };
}

export const tenantService = {
  /**
   * Automatically resolve company tenant by an admin's email address
   */
  async findCompanyByAdminEmail(email) {
    if (!email) return null;
    const cleanEmail = email.trim().toLowerCase();

    // 1. Direct match on master database (Primary Company Admin)
    const primaryCompany = await masterPrisma.company.findFirst({
      where: { adminEmail: cleanEmail }
    });
    if (primaryCompany) {
      return primaryCompany;
    }

    // 2. Search through registered active company tenant databases
    const allCompanies = await masterPrisma.company.findMany({
      where: { status: 'ACTIVE' }
    });

    for (const comp of allCompanies) {
      try {
        const client = await this.getTenantClient(comp.code);
        const admin = await client.admin.findUnique({
          where: { email: cleanEmail }
        });
        if (admin) {
          return comp;
        }
      } catch (err) {
        // Continue searching other companies
      }
    }

    // 3. Fallback: check default database admin
    try {
      const defaultClient = await this.getTenantClient('default');
      const defaultAdmin = await defaultClient.admin.findUnique({
        where: { email: cleanEmail }
      });
      if (defaultAdmin) {
        return { code: 'default', name: 'Default Company' };
      }
    } catch (err) {}

    return null;
  },

  /**
   * Get cached or initialize PrismaClient for a specific tenant code
   */
  async getTenantClient(tenantCode) {
    if (!tenantCode) {
      tenantCode = 'default';
    }

    const normalizedCode = tenantCode.toLowerCase().trim();

    if (tenantClients.has(normalizedCode)) {
      return tenantClients.get(normalizedCode);
    }

    // Lookup company in Master DB
    let company = await masterPrisma.company.findUnique({
      where: { code: normalizedCode }
    });

    if (!company) {
      throw new Error(`Company with code '${tenantCode}' was not found.`);
    }

    if (company.status === 'SUSPENDED') {
      throw new Error(`Company '${company.name}' is currently suspended. Please contact administrator.`);
    }

    // Create a new PrismaClient connected directly to this tenant's database
    const client = new PrismaClient({
      datasources: {
        db: {
          url: company.dbUrl
        }
      }
    });

    tenantClients.set(normalizedCode, client);
    return client;
  },

  /**
   * Create a new tenant database and register company
   */
  async createTenant({
    fullName,
    nricFin,
    email,
    adminEmail,
    phone,
    companyName,
    name,
    department,
    slug,
    code,
    adminPassword
  }) {
    const finalCompanyName = (companyName || name || '').trim();
    const finalSlug = (slug || code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const finalEmail = (email || adminEmail || '').trim().toLowerCase();
    const finalFullName = (fullName || '').trim();
    const finalNricFin = (nricFin || '').trim().toUpperCase();
    const finalPhone = (phone || '').trim();
    const finalDepartment = (department || '').trim();

    if (!finalFullName) {
      throw new Error('Full Name is required.');
    }
    if (!finalNricFin) {
      throw new Error('NRIC/FIN Number is required.');
    }
    if (!finalEmail) {
      throw new Error('Email address is required.');
    }
    if (!finalPhone) {
      throw new Error('Phone number is required.');
    }
    if (!finalCompanyName) {
      throw new Error('Company Name is required.');
    }
    if (!finalSlug || finalSlug.length < 2) {
      throw new Error('A valid Slug with at least 2 alphanumeric characters is required for database uniqueness.');
    }

    // Default password if not provided
    const finalPassword = adminPassword && adminPassword.length >= 6
      ? adminPassword
      : `Admin#${finalSlug.charAt(0).toUpperCase() + finalSlug.slice(1)}2026!`;

    // Check if slug / company code already exists in Master DB
    const existingCompany = await masterPrisma.company.findUnique({
      where: { code: finalSlug }
    });

    if (existingCompany) {
      throw new Error(`Database slug '${finalSlug}' is already in use. Please generate or enter a unique slug.`);
    }

    const { baseUrl, rootUrl } = getDbBaseConfig();
    const dbName = `skillbridge_tenant_${finalSlug}`;
    const tenantDbUrl = `${baseUrl}/${dbName}?schema=public`;

    console.log(`[Multi-Tenant] Starting database creation for company: ${finalCompanyName} (slug: ${finalSlug})...`);
    console.log(`[Multi-Tenant] Target database: ${dbName}`);

    // Step 1: Connect to Postgres root server to create the new database
    const rootClient = new Client({ connectionString: rootUrl });
    try {
      await rootClient.connect();

      // Check if DB already exists
      const checkRes = await rootClient.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [dbName]
      );

      if (checkRes.rowCount === 0) {
        console.log(`[Multi-Tenant] Executing: CREATE DATABASE "${dbName}"...`);
        await rootClient.query(`CREATE DATABASE "${dbName}"`);
        console.log(`[Multi-Tenant] Database "${dbName}" created successfully.`);
      } else {
        console.log(`[Multi-Tenant] Database "${dbName}" already exists on server.`);
      }
    } finally {
      await rootClient.end().catch(() => {});
    }

    // Step 2: Connect to the newly created database and run the schema DDL
    const tenantPgClient = new Client({ connectionString: `${baseUrl}/${dbName}` });
    try {
      await tenantPgClient.connect();
      console.log(`[Multi-Tenant] Applying schema and pgvector to "${dbName}"...`);
      await tenantPgClient.query(tenantSchemaSql);
      console.log(`[Multi-Tenant] Schema successfully applied to "${dbName}".`);

      // Step 3: Insert initial Company Admin with profile details in the tenant database
      const passwordHash = await bcrypt.hash(finalPassword, 10);
      const insertAdminQuery = `
        INSERT INTO "Admin" ("id", "email", "passwordHash", "fullName", "nricFin", "phone", "department", "createdAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT ("email") DO UPDATE SET
          "passwordHash" = EXCLUDED."passwordHash",
          "fullName" = EXCLUDED."fullName",
          "nricFin" = EXCLUDED."nricFin",
          "phone" = EXCLUDED."phone",
          "department" = EXCLUDED."department";
      `;
      await tenantPgClient.query(insertAdminQuery, [
        finalEmail,
        passwordHash,
        finalFullName,
        finalNricFin,
        finalPhone,
        finalDepartment || null
      ]);
      console.log(`[Multi-Tenant] Initial admin (${finalEmail}) seeded in "${dbName}".`);
    } finally {
      await tenantPgClient.end().catch(() => {});
    }

    // Step 4: Register Company in Master Database
    const company = await masterPrisma.company.create({
      data: {
        name: finalCompanyName,
        code: finalSlug,
        dbName: dbName,
        dbUrl: tenantDbUrl,
        adminEmail: finalEmail,
        fullName: finalFullName,
        nricFin: finalNricFin,
        phone: finalPhone,
        department: finalDepartment || null,
        status: 'ACTIVE'
      }
    });

    console.log(`[Multi-Tenant] Company registered in Master DB with ID: ${company.id}`);

    // Step 5: Warm up Prisma client for this tenant
    try {
      const client = new PrismaClient({ datasources: { db: { url: tenantDbUrl } } });
      await client.$connect();
      tenantClients.set(finalSlug, client);
      console.log(`[Multi-Tenant] Tenant Prisma client connected and cached.`);
    } catch (warmErr) {
      console.warn(`[Multi-Tenant] Prisma warmup warning:`, warmErr.message);
    }

    return {
      ...company,
      generatedPassword: finalPassword
    };
  },

  /**
   * List all companies (Metadata only - NO tenant courses/users exposed)
   */
  async listCompanies() {
    return masterPrisma.company.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        dbName: true,
        status: true,
        adminEmail: true,
        fullName: true,
        nricFin: true,
        phone: true,
        department: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
  },

  /**
   * Get single company details with DB connectivity test
   */
  async getCompanyDetails(id) {
    const company = await masterPrisma.company.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        dbName: true,
        status: true,
        adminEmail: true,
        fullName: true,
        nricFin: true,
        phone: true,
        department: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!company) {
      throw new Error('Company not found.');
    }

    // Verify DB connectivity
    let dbStatus = 'ONLINE';
    try {
      const client = await this.getTenantClient(company.code);
      await client.$queryRaw`SELECT 1`;
    } catch (err) {
      dbStatus = 'ERROR: ' + err.message;
    }

    return {
      ...company,
      dbStatus
    };
  },

  /**
   * Toggle or update company status (ACTIVE / SUSPENDED)
   */
  async updateCompanyStatus(id, status) {
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      throw new Error('Invalid status. Allowed values: ACTIVE, SUSPENDED');
    }

    const updated = await masterPrisma.company.update({
      where: { id },
      data: { status }
    });

    // If suspended, drop client from cache
    if (status === 'SUSPENDED') {
      const cached = tenantClients.get(updated.code);
      if (cached) {
        await cached.$disconnect().catch(() => {});
        tenantClients.delete(updated.code);
      }
    }

    return updated;
  },

  /**
   * Update full company profile (name, department, admin contact details, status)
   */
  async updateCompany(id, { name, department, fullName, nricFin, phone, adminEmail, email, status }) {
    const existing = await masterPrisma.company.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Company not found.');
    }

    const dataToUpdate = {};
    if (name && name.trim()) dataToUpdate.name = name.trim();
    if (department !== undefined) dataToUpdate.department = department?.trim() || null;
    if (fullName && fullName.trim()) dataToUpdate.fullName = fullName.trim();
    if (nricFin && nricFin.trim()) dataToUpdate.nricFin = nricFin.trim().toUpperCase();
    if (phone && phone.trim()) dataToUpdate.phone = phone.trim();
    if ((email || adminEmail) && (email || adminEmail).trim()) {
      dataToUpdate.adminEmail = (email || adminEmail).trim().toLowerCase();
    }
    if (status && ['ACTIVE', 'SUSPENDED'].includes(status)) {
      dataToUpdate.status = status;
    }

    const updated = await masterPrisma.company.update({
      where: { id },
      data: dataToUpdate
    });

    // Also sync admin profile in tenant DB if updated
    try {
      const client = await this.getTenantClient(updated.code);
      await client.admin.updateMany({
        where: { email: existing.adminEmail },
        data: {
          email: updated.adminEmail,
          fullName: updated.fullName,
          nricFin: updated.nricFin,
          phone: updated.phone,
          department: updated.department
        }
      });
    } catch (err) {
      console.warn(`[Multi-Tenant] Notice: Could not sync tenant Admin table: ${err.message}`);
    }

    // If status became suspended, drop client from cache
    if (updated.status === 'SUSPENDED') {
      const cached = tenantClients.get(updated.code);
      if (cached) {
        await cached.$disconnect().catch(() => {});
        tenantClients.delete(updated.code);
      }
    }

    return updated;
  },

  /**
   * Delete company and optionally drop the isolated tenant database
   */
  async deleteCompany(id, { dropDatabase = true } = {}) {
    const company = await masterPrisma.company.findUnique({ where: { id } });
    if (!company) {
      throw new Error('Company not found.');
    }

    console.log(`[Multi-Tenant] Deleting company: ${company.name} (${company.code})...`);

    // Disconnect and remove from Prisma client cache
    const cached = tenantClients.get(company.code);
    if (cached) {
      await cached.$disconnect().catch(() => {});
      tenantClients.delete(company.code);
    }

    // Drop database if requested (prevent dropping master database or postgres maintenance DB)
    if (
      dropDatabase &&
      company.dbName &&
      company.dbName !== 'skillbridge_master' &&
      company.dbName !== 'postgres'
    ) {
      const { rootUrl } = getDbBaseConfig();
      const rootClient = new Client({ connectionString: rootUrl });
      try {
        await rootClient.connect();

        // Terminate any active connections to the tenant database
        await rootClient.query(`
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid();
        `, [company.dbName]);

        // Drop the tenant database
        console.log(`[Multi-Tenant] Dropping database "${company.dbName}"...`);
        await rootClient.query(`DROP DATABASE IF EXISTS "${company.dbName}"`);
        console.log(`[Multi-Tenant] Database "${company.dbName}" dropped successfully.`);
      } catch (dbErr) {
        console.error(`[Multi-Tenant] Error dropping database "${company.dbName}":`, dbErr.message);
      } finally {
        await rootClient.end().catch(() => {});
      }
    }

    // Delete company record from Master DB
    await masterPrisma.company.delete({ where: { id } });
    console.log(`[Multi-Tenant] Company record deleted from Master DB.`);

    return {
      message: `Company "${company.name}" and database "${company.dbName}" deleted successfully.`,
      deletedId: id
    };
  },

  /**
   * Ensure default organization exists pointing to the primary skillbridge DB
   */
  async ensureDefaultCompany() {
    try {
      const existing = await masterPrisma.company.findFirst({
        where: {
          OR: [{ code: 'default' }, { code: 'main' }]
        }
      });

      if (!existing) {
        const { defaultDbName } = getDbBaseConfig();
        const defaultDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:praveen@localhost:5432/skillbridge?schema=public';

        await masterPrisma.company.create({
          data: {
            name: 'SkillBridge Main Organization',
            code: 'default',
            dbName: defaultDbName,
            dbUrl: defaultDbUrl,
            adminEmail: 'admin@skillbridge.com',
            status: 'ACTIVE'
          }
        });
        console.log('[Multi-Tenant] Seeded default company pointing to primary database.');
      }
    } catch (err) {
      console.warn('[Multi-Tenant] Could not ensure default company:', err.message);
    }
  }
};

export default tenantService;
