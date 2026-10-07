import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { createTestUser } from '../testing/users.js';
import { SessionService } from './session-service.js';
import { hashToken, issueToken } from './tokens.js';

const prisma = createTestPrisma();
const T0 = new Date('2026-10-07T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let now: Date;
let sessions: SessionService;

beforeEach(async () => {
  await resetDatabase(prisma);
  now = T0;
  sessions = new SessionService(prisma, () => now);
});
afterAll(() => prisma.$disconnect());

const at = (ms: number) => {
  now = new Date(T0.getTime() + ms);
};

describe('SessionService', () => {
  it('세션을 만들면 senv_ss_ 토큰과 7일 뒤 만료 시각을 돌려주고, DB에는 해시만 둔다', async () => {
    const user = await createTestUser(prisma);
    const { token, expiresAt } = await sessions.create(user.id);

    expect(token.startsWith('senv_ss_')).toBe(true);
    expect(expiresAt).toEqual(new Date(T0.getTime() + 7 * DAY));
    const row = await prisma.session.findFirstOrThrow();
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('토큰으로 사용자를 찾는다 (승인 대기 사용자도 세션은 유효하다)', async () => {
    const user = await createTestUser(prisma, { login: 'bob', status: 'pending' });
    const { token } = await sessions.create(user.id);
    expect(await sessions.authenticate(token)).toMatchObject({
      id: user.id,
      login: 'bob',
      status: 'pending',
    });
  });

  it('마지막 사용 후 7일이 지나면 만료되고 세션을 지운다', async () => {
    const user = await createTestUser(prisma);
    const { token } = await sessions.create(user.id);
    at(7 * DAY + 1);
    expect(await sessions.authenticate(token)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it('쓸 때마다 만료가 연장된다', async () => {
    const user = await createTestUser(prisma);
    const { token } = await sessions.create(user.id);

    at(6 * DAY);
    expect(await sessions.authenticate(token)).not.toBeNull();
    at(12 * DAY); // 마지막 사용 후 6일
    expect(await sessions.authenticate(token)).not.toBeNull();
    at(19 * DAY + 1); // 마지막 사용 후 7일 넘음
    expect(await sessions.authenticate(token)).toBeNull();
  });

  it('1시간 안에 다시 쓰면 DB를 갱신하지 않는다', async () => {
    const user = await createTestUser(prisma);
    const { token } = await sessions.create(user.id);

    at(30 * 60 * 1000);
    await sessions.authenticate(token);
    expect((await prisma.session.findFirstOrThrow()).lastUsedAt).toEqual(T0);

    at(2 * HOUR);
    await sessions.authenticate(token);
    expect((await prisma.session.findFirstOrThrow()).lastUsedAt).toEqual(now);
  });

  it.each([
    ['형식이 틀린 토큰', 'not-a-token'],
    ['다른 종류의 토큰', issueToken('access').token],
    ['발급하지 않은 세션 토큰', issueToken('session').token],
  ])('%s 이면 null이다', async (_label, token) => {
    expect(await sessions.authenticate(token)).toBeNull();
  });

  it('비활성화된 사용자의 세션은 쓸 수 없다', async () => {
    const user = await createTestUser(prisma);
    const { token } = await sessions.create(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled' } });
    expect(await sessions.authenticate(token)).toBeNull();
  });

  it('revoke한 세션은 더는 쓸 수 없다', async () => {
    const user = await createTestUser(prisma);
    const { token } = await sessions.create(user.id);
    await sessions.revoke(token);
    expect(await sessions.authenticate(token)).toBeNull();
  });

  it('revokeAllForUser는 그 사용자의 세션만 모두 지운다', async () => {
    const bob = await createTestUser(prisma);
    const carol = await createTestUser(prisma);
    const bob1 = await sessions.create(bob.id);
    const bob2 = await sessions.create(bob.id);
    const carol1 = await sessions.create(carol.id);

    await sessions.revokeAllForUser(bob.id);

    expect(await sessions.authenticate(bob1.token)).toBeNull();
    expect(await sessions.authenticate(bob2.token)).toBeNull();
    expect(await sessions.authenticate(carol1.token)).not.toBeNull();
  });
});
