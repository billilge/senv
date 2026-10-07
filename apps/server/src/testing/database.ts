import { inject } from 'vitest';
import { createPrismaClient } from '../database/prisma.js';
import type { PrismaClient } from '../generated/prisma/client.js';

/** 통합 테스트용 Prisma 클라이언트. 주소는 mysql.global-setup.ts가 넘겨준다 */
export function createTestPrisma(): PrismaClient {
  return createPrismaClient(inject('databaseUrl'));
}

/** 모든 테이블을 비운다. 마이그레이션 기록 테이블은 남긴다 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ name: string }[]>`
    SELECT TABLE_NAME AS name FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '_prisma_migrations'`;
  await prisma.$transaction([
    prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0'),
    ...tables.map(({ name }) => prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${name}\``)),
    prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1'),
  ]);
}
