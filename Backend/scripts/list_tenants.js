import prisma, { defaultPrisma } from '../config/prisma.js';
import masterPrisma from '../config/masterPrisma.js';

async function listAll() {
  console.log('=== Checking Companies / Tenants in masterPrisma ===');
  try {
    const companies = await masterPrisma.company.findMany();
    console.log('Companies count:', companies.length);
    for (const c of companies) {
      console.log(`Company: ${c.name} (${c.code}), dbName: ${c.dbName}`);
    }
  } catch (e) {
    console.log('Master company query error:', e.message);
  }

  console.log('\n=== Checking Courses in default database ===');
  const courses = await defaultPrisma.course.findMany({
    select: { id: true, title: true }
  });
  console.log('Default DB Courses:', courses);

  console.log('\n=== Checking all schemas in PostgreSQL ===');
  const schemas = await defaultPrisma.$queryRawUnsafe(`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_name = 'Course'
  `);
  console.log('Schemas with Course table:', schemas);

  for (const s of schemas) {
    const rows = await defaultPrisma.$queryRawUnsafe(`
      SELECT id, title FROM "${s.table_schema}"."Course"
    `);
    console.log(`Courses in schema "${s.table_schema}":`, rows);
  }
}

listAll().catch(console.error).finally(() => {
  defaultPrisma.$disconnect();
  masterPrisma.$disconnect();
});
