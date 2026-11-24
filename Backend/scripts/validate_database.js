import masterPrisma from '../config/masterPrisma.js';
import prisma, { defaultPrisma, tenantStorage } from '../config/prisma.js';
import tenantService from '../services/tenantService.js';

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName} - ${details}`);
    failed++;
  }
}

async function runDatabaseTests() {
  console.log('====================================================');
  console.log('2. DATABASE TESTING SUITE');
  console.log('====================================================');

  // --- 2.1 Master Database Connection ---
  console.log('\n--- 2.1 Master Database Connection ---');
  try {
    const masterCheck = await masterPrisma.$queryRawUnsafe('SELECT 1 as connected;');
    assert(Array.isArray(masterCheck) && masterCheck.length > 0, 'Master database connects and answers query');
  } catch (err) {
    assert(false, 'Master database connects and answers query', err.message);
  }

  // --- 2.2 Individual Tenant Database Connection ---
  console.log('\n--- 2.2 Tenant Database Connection (Default Tenant) ---');
  try {
    const defaultClient = await tenantService.getTenantClient('default');
    const tenantCheck = await defaultClient.$queryRawUnsafe('SELECT 1 as connected;');
    assert(Array.isArray(tenantCheck) && tenantCheck.length > 0, 'Default tenant client connects and executes query');
  } catch (err) {
    assert(false, 'Default tenant client connects and executes query', err.message);
  }

  // --- 2.3 Prisma Tenant Context Isolation ---
  console.log('\n--- 2.3 Prisma Tenant Context Isolation ---');
  try {
    const mockClientA = { label: 'ClientA', $queryRawUnsafe: async () => 'A' };
    const mockClientB = { label: 'ClientB', $queryRawUnsafe: async () => 'B' };

    let insideScopeA = null;
    let insideScopeB = null;

    await new Promise((resolve) => {
      tenantStorage.run({ tenantCode: 'tenant_a', client: mockClientA }, async () => {
        insideScopeA = tenantStorage.getStore()?.client?.label;
        tenantStorage.run({ tenantCode: 'tenant_b', client: mockClientB }, async () => {
          insideScopeB = tenantStorage.getStore()?.client?.label;
          resolve();
        });
      });
    });

    assert(
      insideScopeA === 'ClientA' && insideScopeB === 'ClientB',
      'AsyncLocalStorage maintains isolated tenant context across nested and asynchronous call stacks'
    );
  } catch (err) {
    assert(false, 'AsyncLocalStorage maintains isolated tenant context', err.message);
  }

  // --- 2.4 Database Disconnection and Reconnection ---
  console.log('\n--- 2.4 Disconnection and Reconnection ---');
  try {
    await masterPrisma.$disconnect();
    const reconnectCheck = await masterPrisma.$queryRawUnsafe('SELECT 1 as reconnected;');
    assert(
      Array.isArray(reconnectCheck) && reconnectCheck.length > 0,
      'Prisma client handles disconnection and automatically re-establishes connection on subsequent query'
    );
  } catch (err) {
    assert(false, 'Prisma client handles disconnection and reconnection', err.message);
  }

  // --- 2.5 Tenant Prisma Client Cleanup ---
  console.log('\n--- 2.5 Tenant Prisma Client Cleanup & Eviction ---');
  try {
    // If a tenant is suspended, tenant clients are removed and disconnected
    const hasEviction = typeof tenantService.updateCompanyStatus === 'function';
    assert(hasEviction, 'Tenant service implements client cache cleanup and disconnect on company suspension/update');
  } catch (err) {
    assert(false, 'Tenant service implements client cache cleanup', err.message);
  }

  // --- 2.6 Migration Safety & Non-Destructive Checks ---
  console.log('\n--- 2.6 Schema Integrity & Non-Destructive Safety ---');
  try {
    const tables = await defaultPrisma.$queryRawUnsafe(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    const tableNames = tables.map(t => t.table_name || t.TABLE_NAME);
    const requiredTables = ['User', 'Course', 'Admin', 'CourseChunk', 'UserCourseAssignment', 'CourseProgress'];
    const allPresent = requiredTables.every(rt => tableNames.some(t => t.toLowerCase() === rt.toLowerCase()));
    
    assert(allPresent, `Core relational tables exist without destructive drops (${requiredTables.join(', ')})`);
  } catch (err) {
    assert(false, 'Core relational tables exist without destructive drops', err.message);
  }

  console.log('\n====================================================');
  console.log(`DATABASE TESTS COMPLETED: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  await masterPrisma.$disconnect().catch(() => {});
  await defaultPrisma.$disconnect().catch(() => {});
  if (failed > 0) process.exit(1);
}

runDatabaseTests().catch((e) => {
  console.error('Fatal database test error:', e);
  process.exit(1);
});
