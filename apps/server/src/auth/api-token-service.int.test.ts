import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { createTestUser } from '../testing/users.js';
import {
  ApiTokenService,
  InvalidRefreshTokenError,
  RefreshTokenReusedError,
} from './api-token-service.js';
import { hashToken } from './tokens.js';

const prisma = createTestPrisma();
const T0 = new Date('2026-10-07T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let now: Date;
let tokens: ApiTokenService;

beforeEach(async () => {
  await resetDatabase(prisma);
  now = T0;
  tokens = new ApiTokenService(prisma, () => now);
});
afterAll(() => prisma.$disconnect());

const at = (ms: number) => {
  now = new Date(T0.getTime() + ms);
};

describe('ApiTokenService', () => {
  it('access(1시간)·refresh(30일) 쌍을 발급하고 DB에는 해시만 둔다', async () => {
    const user = await createTestUser(prisma);
    const pair = await tokens.issuePair(user.id);

    expect(pair.accessToken.startsWith('senv_at_')).toBe(true);
    expect(pair.refreshToken.startsWith('senv_rt_')).toBe(true);
    expect(pair.accessExpiresAt).toEqual(new Date(T0.getTime() + HOUR));
    expect(pair.refreshExpiresAt).toEqual(new Date(T0.getTime() + 30 * DAY));

    const rows = await prisma.apiToken.findMany({ select: { kind: true, tokenHash: true } });
    expect(rows).toEqual(
      expect.arrayContaining([
        { kind: 'access', tokenHash: hashToken(pair.accessToken) },
        { kind: 'refresh', tokenHash: hashToken(pair.refreshToken) },
      ]),
    );
  });

  describe('authenticate', () => {
    it('access 토큰으로 사용자를 찾는다', async () => {
      const user = await createTestUser(prisma, { login: 'bob' });
      const { accessToken } = await tokens.issuePair(user.id);
      expect(await tokens.authenticate(accessToken)).toMatchObject({ id: user.id, login: 'bob' });
    });

    it('access 토큰은 1시간 뒤 만료된다', async () => {
      const user = await createTestUser(prisma);
      const { accessToken } = await tokens.issuePair(user.id);
      at(HOUR);
      expect(await tokens.authenticate(accessToken)).toBeNull();
    });

    it('refresh 토큰으로는 API를 쓸 수 없다', async () => {
      const user = await createTestUser(prisma);
      const { refreshToken } = await tokens.issuePair(user.id);
      expect(await tokens.authenticate(refreshToken)).toBeNull();
    });

    it('비활성화된 사용자의 토큰은 쓸 수 없다', async () => {
      const user = await createTestUser(prisma);
      const { accessToken } = await tokens.issuePair(user.id);
      await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled' } });
      expect(await tokens.authenticate(accessToken)).toBeNull();
    });
  });

  describe('refresh', () => {
    it('새 쌍을 주고, 쓴 refresh 토큰은 다시 쓸 수 없다', async () => {
      const user = await createTestUser(prisma);
      const first = await tokens.issuePair(user.id);
      at(2 * HOUR);

      const second = await tokens.refresh(first.refreshToken);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.accessExpiresAt).toEqual(new Date(now.getTime() + HOUR));
      expect(await tokens.authenticate(second.accessToken)).toMatchObject({ id: user.id });
    });

    it('이미 쓴 refresh 토큰이 다시 오면 그 사용자의 토큰을 모두 폐기한다', async () => {
      const bob = await createTestUser(prisma);
      const carol = await createTestUser(prisma);
      const stolen = await tokens.issuePair(bob.id);
      const carolPair = await tokens.issuePair(carol.id);
      const rotated = await tokens.refresh(stolen.refreshToken);

      await expect(tokens.refresh(stolen.refreshToken)).rejects.toThrow(RefreshTokenReusedError);

      expect(await tokens.authenticate(rotated.accessToken)).toBeNull();
      await expect(tokens.refresh(rotated.refreshToken)).rejects.toThrow();
      expect(await tokens.authenticate(carolPair.accessToken)).not.toBeNull();
    });

    it('같은 refresh 토큰을 동시에 두 번 쓰면 재사용으로 보고 모두 폐기한다', async () => {
      const user = await createTestUser(prisma);
      const { refreshToken } = await tokens.issuePair(user.id);

      const results = await Promise.allSettled([
        tokens.refresh(refreshToken),
        tokens.refresh(refreshToken),
      ]);

      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const issued = results.find((r) => r.status === 'fulfilled');
      const pair = (issued as PromiseFulfilledResult<{ accessToken: string }>).value;
      expect(await tokens.authenticate(pair.accessToken)).toBeNull();
    });

    it.each([
      ['30일이 지난 refresh 토큰', 30 * DAY],
      ['형식이 틀린 토큰', -1],
    ])('%s 이면 InvalidRefreshTokenError다', async (_label, after) => {
      const user = await createTestUser(prisma);
      const { refreshToken } = await tokens.issuePair(user.id);
      if (after >= 0) at(after);
      const token = after >= 0 ? refreshToken : 'not-a-token';
      await expect(tokens.refresh(token)).rejects.toThrow(InvalidRefreshTokenError);
    });

    it('access 토큰으로는 refresh할 수 없다', async () => {
      const user = await createTestUser(prisma);
      const { accessToken } = await tokens.issuePair(user.id);
      await expect(tokens.refresh(accessToken)).rejects.toThrow(InvalidRefreshTokenError);
    });

    it('비활성화된 사용자는 refresh할 수 없다', async () => {
      const user = await createTestUser(prisma);
      const { refreshToken } = await tokens.issuePair(user.id);
      await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled' } });
      await expect(tokens.refresh(refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
    });
  });

  describe('폐기', () => {
    it('revoke한 토큰은 더는 쓸 수 없다 (로그아웃)', async () => {
      const user = await createTestUser(prisma);
      const pair = await tokens.issuePair(user.id);
      await tokens.revoke(pair.accessToken);
      await tokens.revoke(pair.refreshToken);
      expect(await tokens.authenticate(pair.accessToken)).toBeNull();
      await expect(tokens.refresh(pair.refreshToken)).rejects.toThrow();
    });

    it('revokeAllForUser는 그 사용자의 토큰만 모두 폐기한다', async () => {
      const bob = await createTestUser(prisma);
      const carol = await createTestUser(prisma);
      const bobPair = await tokens.issuePair(bob.id);
      const carolPair = await tokens.issuePair(carol.id);

      await tokens.revokeAllForUser(bob.id);

      expect(await tokens.authenticate(bobPair.accessToken)).toBeNull();
      expect(await tokens.authenticate(carolPair.accessToken)).not.toBeNull();
    });
  });
});
