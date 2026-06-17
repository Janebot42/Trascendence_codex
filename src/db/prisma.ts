import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export async function configureSqliteForConcurrency(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
}

export function createPrismaClient(): PrismaClient | null {
  if (!env.DATABASE_URL || env.NODE_ENV === 'test') return null;
  return new PrismaClient();
}
