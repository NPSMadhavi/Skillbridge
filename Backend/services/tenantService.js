import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import masterPrisma from '../config/masterPrisma.js';
import { defaultPrisma } from '../config/prisma.js';
import { sendCompanyAdminCredentials } from './emailService.js';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read tenant schema SQL
const tenantSchemaSql = fs.readFileSync(path.join(__dirname, 'tenantSchema.sql'), 'utf-8');

// In-memory cache for tenant PrismaClient instances
const tenantClients = new Map();
const tenantSyncTimestamps = new Map();

/**
 * Helper to safely mask credentials in database URLs for logging
 */
function maskDbUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch (_) {
    return url.replace(/:[^:@]*@/, ':****@');
  }
}

/**
 * Extract database configurations:
 * 1. MASTER_DATABASE_URL exclusively for provisioning connection (rootUrl)
 * 2. DB_BASE_URL to construct new tenant database connection URLs
 * 3. DATABASE_URL for normal application database connection
 */
function getDbBaseConfig() {
  // 1. Provisioning URL: exclusively MASTER_DATABASE_URL (with fallback to DATABASE_URL)
  const masterDbUrl = process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL;
  if (!masterDbUrl) {
    throw new Error('[TenantService] Error: MASTER_DATABASE_URL (or DATABASE_URL) must be defined in environment for database provisioning.');
  }

  const masterUrlObj = new URL(masterDbUrl);
  const masterBaseUrl = `${masterUrlObj.protocol}//${masterUrlObj.username ? `${masterUrlObj.username}:${masterUrlObj.password}@` : ''}${masterUrlObj.host}`;
  const rootUrl = `${masterBaseUrl}/postgres`;
  const provisioningUser = masterUrlObj.username || 'postgres';

  // 2. Base URL for constructing new tenant database connections (from DB_BASE_URL)
  let baseUrl;
  let tenantOwner = 'skillbridgenormal';

  if (process.env.DB_BASE_URL) {
    baseUrl = process.env.DB_BASE_URL.trim().replace(/\/+$/, '');
    try {
      const baseObj = new URL(baseUrl);
      if (baseObj.username) {
        tenantOwner = baseObj.username;
      }
    } catch (_) {}
  } else if (process.env.DATABASE_URL) {
    const appUrlObj = new URL(process.env.DATABASE_URL);
    baseUrl = `${appUrlObj.protocol}//${appUrlObj.username ? `${appUrlObj.username}:${appUrlObj.password}@` : ''}${appUrlObj.host}`;
    if (appUrlObj.username) {
      tenantOwner = appUrlObj.username;
    }
  } else {
    baseUrl = masterBaseUrl;
    tenantOwner = provisioningUser;
  }

  // 3. Application default database name (kept from DATABASE_URL)
  let defaultDbName = 'skillbridge';
  if (process.env.DATABASE_URL) {
    try {
      const defaultUrlObj = new URL(process.env.DATABASE_URL);
      defaultDbName = defaultUrlObj.pathname.replace(/^\//, '').split('?')[0] || 'skillbridge';
    } catch (_) {}
  }

  return {
    baseUrl,
    rootUrl,
    masterBaseUrl,
    provisioningUser,
    tenantOwner,
    defaultDbName
  };
}

export const tenantService = {
  /**
   * Automatically resolve company tenant by an admin's email address
   */
  async findCompanyByAdminEmail(email) {
    if (!email) return null;
    const cleanEmail = email.trim().toLowerCase();

    try {
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
    } catch (masterErr) {
      console.warn('[TenantService] Master DB query failed in findCompanyByAdminEmail:', masterErr.message);
    }

    // 3. Fallback: check default database admin
    try {
      const defaultAdmin = await defaultPrisma.admin.findUnique({
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

    // Default tenant uses the primary database client directly
    if (normalizedCode === 'default') {
      return defaultPrisma;
    }

    if (tenantClients.has(normalizedCode)) {
      return tenantClients.get(normalizedCode);
    }

    // Lookup company in Master DB
    let company = null;
    try {
      company = await masterPrisma.company.findUnique({
        where: { code: normalizedCode }
      });
    } catch (dbErr) {
      console.warn(`[TenantService] Master DB query failed for tenant '${tenantCode}':`, dbErr.message);
      if (normalizedCode === 'default') {
        return defaultPrisma;
      }
      throw new Error(`Master database unavailable: ${dbErr.message}`);
    }

    if (!company) {
      if (normalizedCode === 'default') {
        return defaultPrisma;
      }
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

    // Ensure backwards-compatible schema columns exist in tenant DB
    client.$executeRawUnsafe(`
      ALTER TABLE IF EXISTS "User"
        ADD COLUMN IF NOT EXISTS "phone" TEXT;
      ALTER TABLE IF EXISTS "Admin"
        ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "fullName" TEXT,
        ADD COLUMN IF NOT EXISTS "nricFin" TEXT,
        ADD COLUMN IF NOT EXISTS "phone" TEXT,
        ADD COLUMN IF NOT EXISTS "department" TEXT;
    `).catch(() => {});

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
    let finalSlug = (slug || code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
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
    const NRIC_FIN_REGEX = /^[STFGMstfgm]\d{7}[A-Za-z]$/;
    if (finalNricFin.length !== 9 || !NRIC_FIN_REGEX.test(finalNricFin)) {
      throw new Error('NRIC/FIN number must be exactly 9 characters starting with S, T, F, G, or M (e.g. S1234567A).');
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

    // Auto-generate clean slug if left blank
    if (!finalSlug || finalSlug.length < 2) {
      const baseWord = finalCompanyName
        .toLowerCase()
        .trim()
        .split(/\s+/)[0]
        .replace(/[^a-z0-9]/g, '') || 'company';
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      finalSlug = `${baseWord}_${randomSuffix}`;
    }

    // Distinct auto-generated password if left blank (NOT equal to slug)
    const isGeneratedPassword = !(adminPassword && adminPassword.trim().length >= 6);
    const cleanPrefix = finalCompanyName.replace(/[^a-zA-Z]/g, '').slice(0, 8);
    const capitalizedPrefix = cleanPrefix
      ? cleanPrefix.charAt(0).toUpperCase() + cleanPrefix.slice(1).toLowerCase()
      : 'Admin';
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const finalPassword = !isGeneratedPassword
      ? adminPassword.trim()
      : `SB#${capitalizedPrefix}${randomDigits}!`;

    // Check if slug / company code already exists in Master DB
    const existingCompany = await masterPrisma.company.findUnique({
      where: { code: finalSlug }
    });

    if (existingCompany) {
      throw new Error(`Database slug '${finalSlug}' is already in use. Please generate or enter a unique slug.`);
    }

    const { baseUrl, rootUrl, masterBaseUrl, provisioningUser, tenantOwner } = getDbBaseConfig();
    const dbName = `skillbridge_tenant_${finalSlug}`;
    const tenantDbUrl = `${baseUrl}/${dbName}?schema=public`;

    console.log(`[Multi-Tenant] Starting database provisioning for company: "${finalCompanyName}" (slug: ${finalSlug})`);
    console.log(`[Multi-Tenant] Provisioning connection (rootUrl): ${maskDbUrl(rootUrl)}`);
    console.log(`[Multi-Tenant] Provisioning User (from MASTER_DATABASE_URL): "${provisioningUser}"`);
    console.log(`[Multi-Tenant] Tenant Database Target URL (from DB_BASE_URL): ${maskDbUrl(tenantDbUrl)}`);
    console.log(`[Multi-Tenant] Target Database Name: "${dbName}"`);
    console.log(`[Multi-Tenant] Assigned Database Owner: "${tenantOwner}"`);

    // Step 1: Connect to Postgres root server using MASTER_DATABASE_URL (outside Prisma transactions)
    const rootClient = new Client({ connectionString: rootUrl });
    try {
      await rootClient.connect();

      // Verify and log provisioning user details without exposing passwords
      try {
        const userCheck = await rootClient.query(`
          SELECT
              current_user,
              session_user,
              (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) AS can_create_database
        `);
        const row = userCheck.rows[0] || {};
        console.log(`[Multi-Tenant] Active provisioning session: user="${row.current_user}", session_user="${row.session_user}", can_create_database=${row.can_create_database}`);
      } catch (checkErr) {
        console.warn("[Multi-Tenant] Notice checking provisioning user permissions:", checkErr.message);
      }

      // Check if DB already exists
      const checkRes = await rootClient.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [dbName]
      );

      if (checkRes.rowCount === 0) {
        // Check if tenantOwner role exists
        const roleCheck = await rootClient.query(
          'SELECT rolname FROM pg_roles WHERE rolname = $1',
          [tenantOwner]
        );
        const roleExists = roleCheck.rowCount > 0;

        if (roleExists && tenantOwner !== provisioningUser) {
          // Grant tenantOwner role to provisioningUser if needed so PostgreSQL permits setting ownership
          try {
            await rootClient.query(`GRANT "${tenantOwner}" TO "${provisioningUser}"`);
          } catch (_) {}
        }

        let createdWithOwner = false;
        if (roleExists) {
          try {
            console.log(`[Multi-Tenant] Executing: CREATE DATABASE "${dbName}" OWNER "${tenantOwner}"...`);
            await rootClient.query(`CREATE DATABASE "${dbName}" OWNER "${tenantOwner}"`);
            createdWithOwner = true;
            console.log(`[Multi-Tenant] Database "${dbName}" created successfully with OWNER "${tenantOwner}".`);
          } catch (createOwnerErr) {
            console.warn(`[Multi-Tenant] Notice: CREATE DATABASE with OWNER failed (${createOwnerErr.message}). Creating standard database and altering owner...`);
          }
        }

        if (!createdWithOwner) {
          console.log(`[Multi-Tenant] Executing: CREATE DATABASE "${dbName}"...`);
          await rootClient.query(`CREATE DATABASE "${dbName}"`);
          console.log(`[Multi-Tenant] Database "${dbName}" created successfully.`);

          if (roleExists) {
            try {
              await rootClient.query(`ALTER DATABASE "${dbName}" OWNER TO "${tenantOwner}"`);
              console.log(`[Multi-Tenant] Database "${dbName}" owner set to "${tenantOwner}".`);
            } catch (alterErr) {
              console.warn(`[Multi-Tenant] Notice: Could not ALTER DATABASE OWNER to "${tenantOwner}":`, alterErr.message);
            }
          }
        }

        // Ensure tenantOwner role has connect and all privileges on the new database
        if (roleExists) {
          try {
            await rootClient.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${tenantOwner}"`);
          } catch (grantErr) {
            console.warn(`[Multi-Tenant] Notice: GRANT ALL PRIVILEGES TO "${tenantOwner}":`, grantErr.message);
          }
        }
      } else {
        console.log(`[Multi-Tenant] Database "${dbName}" already exists on server.`);
      }
    } finally {
      await rootClient.end().catch(() => {});
    }

    // Step 2: Connect to the newly created database and run the schema DDL
    // Initialize schema using provisioning user (which has privileges for extensions and DDL)
    const initPgClient = new Client({ connectionString: `${masterBaseUrl}/${dbName}` });
    let initConnected = false;
    try {
      await initPgClient.connect();
      initConnected = true;
      console.log(`[Multi-Tenant] Applying schema and pgvector to "${dbName}" using provisioning connection...`);
      await initPgClient.query(tenantSchemaSql);
      console.log(`[Multi-Tenant] Schema successfully applied to "${dbName}".`);

      // Ensure public schema and all newly created tables/sequences are accessible to tenantOwner
      if (tenantOwner && tenantOwner !== provisioningUser) {
        try {
          await initPgClient.query(`
            GRANT ALL ON SCHEMA public TO "${tenantOwner}";
            GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${tenantOwner}";
            GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${tenantOwner}";
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${tenantOwner}";
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${tenantOwner}";
          `);
        } catch (grantErr) {
          console.warn(`[Multi-Tenant] Notice granting schema privileges to "${tenantOwner}":`, grantErr.message);
        }
      }

      // Step 3: Insert initial Company Admin with profile details in the tenant database
      const passwordHash = await bcrypt.hash(finalPassword, 10);
      const mustChangePassword = isGeneratedPassword;
      const insertAdminQuery = `
        INSERT INTO "Admin" ("id", "email", "passwordHash", "fullName", "nricFin", "phone", "department", "mustChangePassword", "createdAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT ("email") DO UPDATE SET
          "passwordHash" = EXCLUDED."passwordHash",
          "fullName" = EXCLUDED."fullName",
          "nricFin" = EXCLUDED."nricFin",
          "phone" = EXCLUDED."phone",
          "department" = EXCLUDED."department",
          "mustChangePassword" = EXCLUDED."mustChangePassword";
      `;
      await initPgClient.query(insertAdminQuery, [
        finalEmail,
        passwordHash,
        finalFullName,
        finalNricFin,
        finalPhone,
        finalDepartment || null,
        mustChangePassword
      ]);
      console.log(`[Multi-Tenant] Initial admin (${finalEmail}) seeded in "${dbName}" (mustChangePassword: ${mustChangePassword}).`);
    } catch (initErr) {
      if (!initConnected) {
        console.warn(`[Multi-Tenant] Provisioning client could not connect directly to new DB (${initErr.message}). Trying tenant connection...`);
        const fallbackClient = new Client({ connectionString: `${baseUrl}/${dbName}` });
        try {
          await fallbackClient.connect();
          await fallbackClient.query(tenantSchemaSql);
          const passwordHash = await bcrypt.hash(finalPassword, 10);
          await fallbackClient.query(`
            INSERT INTO "Admin" ("id", "email", "passwordHash", "fullName", "nricFin", "phone", "department", "mustChangePassword", "createdAt")
            VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT ("email") DO UPDATE SET
              "passwordHash" = EXCLUDED."passwordHash",
              "fullName" = EXCLUDED."fullName",
              "nricFin" = EXCLUDED."nricFin",
              "phone" = EXCLUDED."phone",
              "department" = EXCLUDED."department",
              "mustChangePassword" = EXCLUDED."mustChangePassword";
          `, [finalEmail, passwordHash, finalFullName, finalNricFin, finalPhone, finalDepartment || null, isGeneratedPassword]);
        } finally {
          await fallbackClient.end().catch(() => {});
        }
      } else {
        throw initErr;
      }
    } finally {
      if (initConnected) {
        await initPgClient.end().catch(() => {});
      }
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
        aiName: 'ARIA',
        wakeWord: 'Hey ARIA',
        status: 'ACTIVE'
      }
    });

    console.log(`[Multi-Tenant] Company successfully registered in Master DB with ID: ${company.id}`);

    // Step 5: Verify that the tenant Prisma client connects successfully (Requirement 7)
    console.log(`[Multi-Tenant] Verifying tenant Prisma client connection at: ${maskDbUrl(tenantDbUrl)}...`);
    const client = new PrismaClient({ datasources: { db: { url: tenantDbUrl } } });
    await client.$connect();

    // Verify query connectivity using tenant client
    const probe = await client.$queryRaw`SELECT current_user, session_user`;
    console.log(`[Multi-Tenant] Verified: Tenant Prisma client connected successfully to "${dbName}". Connection probe:`, probe);

    tenantClients.set(finalSlug, client);

    // Step 6: Dispatch login credentials email to the new Company Administrator
    let emailStatus = { sent: false };
    try {
      const emailResult = await sendCompanyAdminCredentials({
        adminEmail: finalEmail,
        fullName: finalFullName,
        companyName: finalCompanyName,
        slug: finalSlug,
        password: finalPassword,
        loginUrl: process.env.APP_FRONTEND_URL
          ? `${process.env.APP_FRONTEND_URL}/admin/login`
          : 'http://localhost:5173/admin/login'
      });
      emailStatus = {
        sent: emailResult.success,
        previewUrl: emailResult.previewUrl || null,
        error: emailResult.error || null
      };
      console.log(`[Multi-Tenant] Credentials email dispatch status for ${finalEmail}:`, emailStatus);
    } catch (mailErr) {
      console.warn(`[Multi-Tenant] Warning: Could not deliver credentials email:`, mailErr.message);
      emailStatus = { sent: false, error: mailErr.message };
    }

    return {
      ...company,
      generatedPassword: finalPassword,
      emailStatus
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
   * Update full company profile (name, department, admin contact details, status, password)
   */
  async updateCompany(id, { name, department, fullName, nricFin, phone, adminEmail, email, status, password, adminPassword }) {
    const existing = await masterPrisma.company.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Company not found.');
    }

    const newPassword = (password || adminPassword || '').trim();
    if (newPassword && newPassword.length < 6) {
      throw new Error('Admin password must be at least 6 characters long.');
    }

    const dataToUpdate = {};
    if (name && name.trim()) dataToUpdate.name = name.trim();
    if (department !== undefined) dataToUpdate.department = department?.trim() || null;
    if (fullName && fullName.trim()) dataToUpdate.fullName = fullName.trim();
    if (nricFin && nricFin.trim()) {
      const cleanFin = nricFin.trim().toUpperCase();
      const NRIC_FIN_REGEX = /^[STFGMstfgm]\d{7}[A-Za-z]$/;
      if (cleanFin.length !== 9 || !NRIC_FIN_REGEX.test(cleanFin)) {
        throw new Error('NRIC/FIN number must be exactly 9 characters starting with S, T, F, G, or M (e.g. S1234567A).');
      }
      dataToUpdate.nricFin = cleanFin;
    }
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
      const adminUpdateData = {
        email: updated.adminEmail,
        fullName: updated.fullName,
        nricFin: updated.nricFin,
        phone: updated.phone,
        department: updated.department
      };

      if (newPassword && newPassword.length >= 6) {
        adminUpdateData.passwordHash = await bcrypt.hash(newPassword, 10);
      }

      await client.admin.updateMany({
        where: { email: existing.adminEmail },
        data: adminUpdateData
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
   * Get all company administrators for a given company
   */
  async getCompanyAdmins(companyId) {
    const company = await masterPrisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        code: true,
        dbName: true,
        status: true,
        adminEmail: true,
        fullName: true,
        phone: true,
        department: true,
      }
    });

    if (!company) {
      throw new Error('Company not found.');
    }

    try {
      const client = await this.getTenantClient(company.code);
      const admins = await client.admin.findMany({
        select: {
          id: true,
          email: true,
          fullName: true,
          nricFin: true,
          phone: true,
          department: true,
          mustChangePassword: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      });

      return {
        company,
        admins
      };
    } catch (err) {
      console.error(`[Multi-Tenant] Error fetching company admins for ${company.code}:`, err);
      return {
        company,
        admins: [
          {
            id: 'primary',
            email: company.adminEmail,
            fullName: company.fullName || 'Primary Administrator',
            nricFin: company.nricFin || '',
            phone: company.phone || '',
            department: company.department || '',
            mustChangePassword: false,
            createdAt: new Date().toISOString()
          }
        ]
      };
    }
  },

  /**
   * Change password for a company administrator
   */
  async changeCompanyAdminPassword(companyId, { adminId, adminEmail, password, mustChangePassword = false, sendEmail = true }) {
    const company = await masterPrisma.company.findUnique({
      where: { id: companyId }
    });

    if (!company) {
      throw new Error('Company not found.');
    }

    const cleanPassword = (password || '').trim();
    if (!cleanPassword || cleanPassword.length < 6) {
      throw new Error('New password must be at least 6 characters long.');
    }

    const client = await this.getTenantClient(company.code);
    const passwordHash = await bcrypt.hash(cleanPassword, 10);

    let targetAdmin = null;
    if (adminId && adminId !== 'primary') {
      targetAdmin = await client.admin.findUnique({ where: { id: adminId } });
    }
    if (!targetAdmin && adminEmail) {
      targetAdmin = await client.admin.findUnique({ where: { email: adminEmail.trim().toLowerCase() } });
    }
    if (!targetAdmin && company.adminEmail) {
      targetAdmin = await client.admin.findUnique({ where: { email: company.adminEmail } });
    }

    if (!targetAdmin) {
      throw new Error(`Admin not found in company "${company.name}" database.`);
    }

    const updatedAdmin = await client.admin.update({
      where: { id: targetAdmin.id },
      data: {
        passwordHash,
        mustChangePassword: Boolean(mustChangePassword)
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        nricFin: true,
        phone: true,
        department: true,
        mustChangePassword: true
      }
    });

    // Optional email dispatch
    let emailStatus = null;
    if (sendEmail) {
      try {
        emailStatus = await sendCompanyAdminCredentials({
          adminEmail: updatedAdmin.email,
          fullName: updatedAdmin.fullName || company.fullName || 'Company Administrator',
          companyName: company.name,
          slug: company.code,
          password: cleanPassword
        });
      } catch (mailErr) {
        console.warn(`[Multi-Tenant] Could not send password update email to ${updatedAdmin.email}:`, mailErr.message);
        emailStatus = { success: false, error: mailErr.message };
      }
    }

    return {
      success: true,
      message: `Password for admin ${updatedAdmin.email} has been updated successfully.`,
      company: {
        id: company.id,
        name: company.name,
        code: company.code
      },
      admin: updatedAdmin,
      newPassword: cleanPassword,
      emailStatus
    };
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
      const { rootUrl, provisioningUser } = getDbBaseConfig();
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
        console.log(`[Multi-Tenant] Dropping database "${company.dbName}" via provisioning user "${provisioningUser}" (${maskDbUrl(rootUrl)})...`);
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
      const { baseUrl, rootUrl, defaultDbName, provisioningUser, tenantOwner } = getDbBaseConfig();
      const defaultDbUrl = (process.env.DATABASE_URL || (() => { throw new Error('[TenantService] Error: DATABASE_URL must be defined in environment.'); })());

      // 1. Ensure the default database exists on PostgreSQL server using provisioning connection
      const rootClient = new Client({ connectionString: rootUrl });
      try {
        await rootClient.connect();
        const checkRes = await rootClient.query(
          'SELECT 1 FROM pg_database WHERE datname = $1',
          [defaultDbName]
        );
        if (checkRes.rowCount === 0) {
          console.log(`[Multi-Tenant] Creating default database "${defaultDbName}" via provisioning user "${provisioningUser}"...`);
          try {
            await rootClient.query(`CREATE DATABASE "${defaultDbName}" OWNER "${tenantOwner}"`);
          } catch (_) {
            await rootClient.query(`CREATE DATABASE "${defaultDbName}"`);
          }
          console.log(`[Multi-Tenant] Database "${defaultDbName}" created successfully.`);
        }
      } catch (dbCreateErr) {
        console.warn(`[Multi-Tenant] Notice checking/creating default database "${defaultDbName}":`, dbCreateErr.message);
      } finally {
        await rootClient.end().catch(() => {});
      }

      // 2. Ensure schema is applied to the default database
      const defaultPgClient = new Client({ connectionString: `${baseUrl}/${defaultDbName}` });
      try {
        await defaultPgClient.connect();
        await defaultPgClient.query(tenantSchemaSql);
      } catch (schemaErr) {
        console.warn('[Multi-Tenant] Notice applying schema to default DB:', schemaErr.message);
      } finally {
        await defaultPgClient.end().catch(() => {});
      }

      // 3. Ensure master company record exists and points to default database
      const existing = await masterPrisma.company.findFirst({
        where: {
          OR: [{ code: 'default' }, { code: 'main' }]
        }
      });

      if (!existing) {
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
      } else if (existing.dbUrl !== defaultDbUrl || existing.dbName !== defaultDbName) {
        await masterPrisma.company.update({
          where: { id: existing.id },
          data: {
            dbName: defaultDbName,
            dbUrl: defaultDbUrl
          }
        });
        console.log(`[Multi-Tenant] Updated default company database to "${defaultDbName}".`);
      }

      // 4. Ensure required schema columns exist in default database
      await defaultPrisma.$executeRawUnsafe(`
        ALTER TABLE IF EXISTS "User"
        ADD COLUMN IF NOT EXISTS "phone" TEXT;
      ALTER TABLE IF EXISTS "Admin"
          ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS "fullName" TEXT,
          ADD COLUMN IF NOT EXISTS "nricFin" TEXT,
          ADD COLUMN IF NOT EXISTS "phone" TEXT,
          ADD COLUMN IF NOT EXISTS "department" TEXT;
      `).catch(err => {
        console.warn('[Multi-Tenant] Auto-migration on default DB skipped/failed:', err.message);
      });

      // 5. Ensure default admin user exists
      const adminCount = await defaultPrisma.admin.count().catch(() => 0);
      if (adminCount === 0) {
        const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'ChangeThisAdminPassword123!';
        const defaultAdminEmail = (process.env.ADMIN_EMAIL || 'admin@skillbridge.com').toLowerCase().trim();
        const passwordHash = await bcrypt.hash(defaultAdminPassword, 12);
        await defaultPrisma.admin.create({
          data: {
            email: defaultAdminEmail,
            passwordHash,
            mustChangePassword: false
          }
        }).catch(err => {
          console.warn('[Multi-Tenant] Notice creating default admin:', err.message);
        });
        console.log(`[Multi-Tenant] Default admin created: ${defaultAdminEmail}`);
      }
    } catch (err) {
      console.warn('[Multi-Tenant] Could not ensure default company:', err.message);
    }
  },

  /**
   * Synchronize courses to tenant (disabled for strict multi-tenant isolation)
   */
  async syncDefaultCoursesToTenant(tenantCode) {
    // Disabled: each company maintains its own independent, isolated course catalog.
    return;
  }
};

export default tenantService;

