import { AsyncLocalStorage } from 'async_hooks';
import { PrismaClient } from '@prisma/client';

export const tenantStorage = new AsyncLocalStorage();

// Default fallback client (points to default DATABASE_URL in .env)
const defaultPrisma = new PrismaClient();

/**
 * Dynamic Prisma Proxy:
 * Whenever prisma.<model> or prisma.$method is accessed, this Proxy transparently
 * routes the operation to the current request's tenant database via AsyncLocalStorage.
 * If no tenant context is active (e.g., during startup/scripts), it falls back to defaultPrisma.
 */
const prisma = new Proxy(defaultPrisma, {
  get(target, prop, receiver) {
    const store = tenantStorage.getStore();
    const activeClient = store?.client || defaultPrisma;

    const value = Reflect.get(activeClient, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(activeClient);
    }
    return value;
  }
});

export default prisma;
