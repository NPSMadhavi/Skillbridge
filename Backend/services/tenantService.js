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
 * Extract base connection URL from DATABASE_URL or DB_BASE_URL
 */
function getDbBaseConfig() {
  const dbUrl = (process.env.DATABASE_URL || (() => { throw new Error('[TenantService] Error: DATABASE_URL must be defined in environment.'); })());
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
      await tenantPgClient.query(insertAdminQuery, [
        finalEmail,
        passwordHash,
        finalFullName,
        finalNricFin,
        finalPhone,
        finalDepartment || null,
        mustChangePassword
      ]);
      console.log(`[Multi-Tenant] Initial admin (${finalEmail}) seeded in "${dbName}" (mustChangePassword: ${mustChangePassword}).`);
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
        aiName: 'ARIA',
        wakeWord: 'Hey ARIA',
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

      // Step 6: Automatically sync existing course catalog to newly created tenant
      await this.syncDefaultCoursesToTenant(finalSlug);
    } catch (warmErr) {
      console.warn(`[Multi-Tenant] Prisma warmup warning:`, warmErr.message);
    }

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
      const { baseUrl, rootUrl, defaultDbName } = getDbBaseConfig();
      const defaultDbUrl = (process.env.DATABASE_URL || (() => { throw new Error('[TenantService] Error: DATABASE_URL must be defined in environment.'); })());

      // 1. Ensure the default database exists on PostgreSQL server
      const rootClient = new Client({ connectionString: rootUrl });
      try {
        await rootClient.connect();
        const checkRes = await rootClient.query(
          'SELECT 1 FROM pg_database WHERE datname = $1',
          [defaultDbName]
        );
        if (checkRes.rowCount === 0) {
          console.log(`[Multi-Tenant] Creating default database "${defaultDbName}"...`);
          await rootClient.query(`CREATE DATABASE "${defaultDbName}"`);
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
   * Synchronize all courses, chunks, and curriculum from the primary (default) database
   * to an isolated company tenant database so all companies have immediate access to all courses.
   */
  async syncDefaultCoursesToTenant(tenantCode) {
    if (!tenantCode || tenantCode === 'default') return;

    // Throttle: sync at most once every 15 minutes per tenant
    const lastSync = tenantSyncTimestamps.get(tenantCode);
    if (lastSync && Date.now() - lastSync < 15 * 60 * 1000) {
      return;
    }
    tenantSyncTimestamps.set(tenantCode, Date.now());

    try {
      const tenantClient = await this.getTenantClient(tenantCode);
      if (!tenantClient) return;

      const defaultCourses = await defaultPrisma.course.findMany();
      if (!defaultCourses || defaultCourses.length === 0) return;

      for (const course of defaultCourses) {
        // 1. Upsert course record in tenant DB
        await tenantClient.course.upsert({
          where: { id: course.id },
          create: {
            id: course.id,
            title: course.title,
            description: course.description,
            fileName: course.fileName,
            fileText: course.fileText,
            curriculum: course.curriculum,
            createdAt: course.createdAt,
            updatedAt: course.updatedAt,
          },
          update: {
            title: course.title,
            description: course.description,
            fileName: course.fileName,
            fileText: course.fileText,
            curriculum: course.curriculum,
            updatedAt: course.updatedAt,
          }
        });

        // 2. Check chunks count
        const tenantChunksCount = await tenantClient.courseChunk.count({
          where: { courseId: course.id }
        });

        const defaultChunksCount = await defaultPrisma.courseChunk.count({
          where: { courseId: course.id }
        });

        if (tenantChunksCount < defaultChunksCount) {
          const chunks = await defaultPrisma.$queryRawUnsafe(`
            SELECT "id", "courseId", "chunkIndex", "chunkText", "topic", "subtopic", "concept",
                   "chunkType", "sourcePage", "sourceSlides", "sourceSection", "prerequisites",
                   "keyPoints", "relatedConcepts", "metadata", "semanticSummary",
                   "embedding"::text as "embeddingStr", "createdAt"
            FROM "CourseChunk"
            WHERE "courseId" = $1
          `, course.id);

          for (const c of chunks) {
            try {
              if (c.embeddingStr) {
                await tenantClient.$executeRawUnsafe(`
                  INSERT INTO "CourseChunk" (
                    "id", "courseId", "chunkIndex", "chunkText", "topic", "subtopic", "concept",
                    "chunkType", "sourcePage", "sourceSlides", "sourceSection", "prerequisites",
                    "keyPoints", "relatedConcepts", "metadata", "semanticSummary",
                    "embedding", "createdAt"
                  ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                    $17::vector, $18
                  )
                  ON CONFLICT ("id") DO NOTHING
                `,
                  c.id, c.courseId, c.chunkIndex, c.chunkText, c.topic, c.subtopic, c.concept,
                  c.chunkType, c.sourcePage, c.sourceSlides ? JSON.stringify(c.sourceSlides) : null,
                  c.sourceSection, c.prerequisites, c.keyPoints ? JSON.stringify(c.keyPoints) : null,
                  c.relatedConcepts ? JSON.stringify(c.relatedConcepts) : null,
                  c.metadata ? JSON.stringify(c.metadata) : null,
                  c.semanticSummary, c.embeddingStr, c.createdAt
                );
              } else {
                await tenantClient.$executeRawUnsafe(`
                  INSERT INTO "CourseChunk" (
                    "id", "courseId", "chunkIndex", "chunkText", "topic", "subtopic", "concept",
                    "chunkType", "sourcePage", "sourceSlides", "sourceSection", "prerequisites",
                    "keyPoints", "relatedConcepts", "metadata", "semanticSummary",
                    "createdAt"
                  ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
                  )
                  ON CONFLICT ("id") DO NOTHING
                `,
                  c.id, c.courseId, c.chunkIndex, c.chunkText, c.topic, c.subtopic, c.concept,
                  c.chunkType, c.sourcePage, c.sourceSlides ? JSON.stringify(c.sourceSlides) : null,
                  c.sourceSection, c.prerequisites, c.keyPoints ? JSON.stringify(c.keyPoints) : null,
                  c.relatedConcepts ? JSON.stringify(c.relatedConcepts) : null,
                  c.metadata ? JSON.stringify(c.metadata) : null,
                  c.semanticSummary, c.createdAt
                );
              }
            } catch (chunkErr) {
              console.warn(`[TenantService] Notice copying chunk ${c.id}:`, chunkErr.message);
            }
          }
        }
      }
      console.log(`[TenantService] Synchronized ${defaultCourses.length} default courses to tenant: ${tenantCode}`);
    } catch (err) {
      console.warn(`[TenantService] Course sync notice for tenant ${tenantCode}:`, err.message);
    }
  }
};

export default tenantService;

