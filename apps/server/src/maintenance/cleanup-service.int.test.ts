import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { createTestUser } from '../testing/users.js';
import { CleanupService } from './cleanup-service.js';

const prisma = createTestPrisma();
const NOW = new Date('2026-10-07T09:00:00.000Z');
const MINUTE = 60 * 1000;
const before = new Date(NOW.getTime() - MINUTE);
const after = new Date(NOW.getTime() + MINUTE);

let cleanup: CleanupService;
let sequence = 0;

beforeEach(async () => {
  await resetDatabase(prisma);
  cleanup = new CleanupService(prisma, () => NOW);
});
afterAll(() => prisma.$disconnect());

const hash = () => String(++sequence).padStart(64, '0');

async function seed(db: PrismaClient, userId: string) {
  const common = { userId, createdAt: before };
  await db.session.createMany({
    data: [
      { ...common, tokenHash: hash(), lastUsedAt: before, expiresAt: before },
      { ...common, tokenHash: hash(), lastUsedAt: before, expiresAt: after },
    ],
  });
  await db.apiToken.createMany({
    data: [
      { ...common, kind: 'access', tokenHash: hash(), expiresAt: before },
      { ...common, kind: 'refresh', tokenHash: hash(), expiresAt: before, revokedAt: before },
      { ...common, kind: 'access', tokenHash: hash(), expiresAt: after },
      // 쓰인(폐기된) refresh 토큰은 만료 전까지 재사용 감지에 필요하다
      { ...common, kind: 'refresh', tokenHash: hash(), expiresAt: after, revokedAt: before },
    ],
  });
  await db.deviceCode.createMany({
    data: [
      {
        deviceCodeHash: hash(),
        userCode: 'BCDFGHJK',
        intervalSeconds: 5,
        createdAt: before,
        expiresAt: before,
      },
      {
        deviceCodeHash: hash(),
        userCode: 'WXYZBCDF',
        intervalSeconds: 5,
        createdAt: before,
        expiresAt: after,
      },
    ],
  });
}

describe('CleanupService', () => {
  it('만료된 세션·토큰·디바이스 코드를 지우고 지운 수를 돌려준다', async () => {
    const user = await createTestUser(prisma);
    await seed(prisma, user.id);

    expect(await cleanup.removeExpired()).toEqual({ sessions: 1, apiTokens: 2, deviceCodes: 1 });

    expect(await prisma.session.count()).toBe(1);
    expect(await prisma.deviceCode.findMany({ select: { userCode: true } })).toEqual([
      { userCode: 'WXYZBCDF' },
    ]);
    const tokens = await prisma.apiToken.findMany({ select: { expiresAt: true } });
    expect(tokens.map((token) => token.expiresAt)).toEqual([after, after]);
  });

  it('지울 것이 없으면 모두 0이다', async () => {
    expect(await cleanup.removeExpired()).toEqual({ sessions: 0, apiTokens: 0, deviceCodes: 0 });
  });

  it('만료 시각이 지금과 같으면 만료로 본다', async () => {
    const user = await createTestUser(prisma);
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hash(),
        createdAt: before,
        lastUsedAt: before,
        expiresAt: NOW,
      },
    });
    expect((await cleanup.removeExpired()).sessions).toBe(1);
  });
});
