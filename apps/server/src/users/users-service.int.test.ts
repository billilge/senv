import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiTokenService } from '../auth/api-token-service.js';
import { USER_FIELDS, type UserView } from '../auth/auth-service.js';
import { SessionService } from '../auth/session-service.js';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { createTestUser } from '../testing/users.js';
import {
  AdminRequiredError,
  CannotDisableSelfError,
  LastAdminError,
  UserNotFoundError,
  UsersService,
} from './users-service.js';

const prisma = createTestPrisma();

let sessions: SessionService;
let tokens: ApiTokenService;
let users: UsersService;
let admin: UserView;

async function view(id: string): Promise<UserView> {
  return prisma.user.findUniqueOrThrow({ where: { id }, select: USER_FIELDS });
}

async function makeUser(overrides: Parameters<typeof createTestUser>[1] = {}) {
  return view((await createTestUser(prisma, overrides)).id);
}

beforeEach(async () => {
  await resetDatabase(prisma);
  sessions = new SessionService(prisma);
  tokens = new ApiTokenService(prisma);
  users = new UsersService(prisma, sessions, tokens);
  admin = await makeUser({ login: 'admin', role: 'admin', status: 'active' });
});
afterAll(() => prisma.$disconnect());

describe('UsersService', () => {
  it('관리자는 승인 대기 사용자를 활성으로 만든다', async () => {
    const bob = await makeUser({ login: 'bob', status: 'pending' });
    expect(await users.activate(bob.id, admin)).toMatchObject({ id: bob.id, status: 'active' });
  });

  it('비활성화하면 그 사용자의 세션과 CLI 토큰이 즉시 폐기된다', async () => {
    const bob = await makeUser({ login: 'bob' });
    const session = await sessions.create(bob.id);
    const pair = await tokens.issuePair(bob.id);

    expect(await users.disable(bob.id, admin)).toMatchObject({ status: 'disabled' });

    expect(await prisma.session.count({ where: { userId: bob.id } })).toBe(0);
    expect(await sessions.authenticate(session.token)).toBeNull();
    // 다시 활성화해도 예전 토큰은 살아나지 않는다
    await users.activate(bob.id, admin);
    expect(await tokens.authenticate(pair.accessToken)).toBeNull();
  });

  it('관리자는 멤버를 관리자로 올리고, 관리자가 둘 이상이면 한 명을 내릴 수 있다', async () => {
    const bob = await makeUser({ login: 'bob' });
    expect(await users.setRole(bob.id, 'admin', admin)).toMatchObject({ role: 'admin' });
    expect(await users.setRole(admin.id, 'member', await view(bob.id))).toMatchObject({
      role: 'member',
    });
  });

  it('마지막 활성 관리자는 강등하거나 비활성화할 수 없다', async () => {
    const other = await makeUser({ login: 'other', role: 'admin', status: 'disabled' });
    await expect(users.setRole(admin.id, 'member', admin)).rejects.toThrow(LastAdminError);
    // 비활성 관리자는 세지 않는다
    expect((await view(other.id)).status).toBe('disabled');

    const second = await makeUser({ login: 'second', role: 'admin', status: 'active' });
    await users.disable(second.id, admin);
    await expect(users.setRole(admin.id, 'member', admin)).rejects.toThrow(LastAdminError);
  });

  it('자기 자신은 비활성화할 수 없다', async () => {
    await makeUser({ login: 'second', role: 'admin', status: 'active' });
    await expect(users.disable(admin.id, admin)).rejects.toThrow(CannotDisableSelfError);
  });

  it.each([
    ['멤버', { role: 'member', status: 'active' }],
    ['비활성 관리자', { role: 'admin', status: 'disabled' }],
    ['승인 대기 관리자', { role: 'admin', status: 'pending' }],
  ] as const)('%s는 사용자 관리를 할 수 없다', async (_label, actorFields) => {
    const actor = await makeUser({ login: 'actor', ...actorFields });
    const bob = await makeUser({ login: 'bob', status: 'pending' });

    await expect(users.list(actor)).rejects.toThrow(AdminRequiredError);
    await expect(users.activate(bob.id, actor)).rejects.toThrow(AdminRequiredError);
    await expect(users.disable(bob.id, actor)).rejects.toThrow(AdminRequiredError);
    await expect(users.setRole(bob.id, 'admin', actor)).rejects.toThrow(AdminRequiredError);
  });

  it('목록은 승인 대기 사용자를 먼저, 그다음 사용자명 순으로 보여준다', async () => {
    await makeUser({ login: 'zed', status: 'pending' });
    await makeUser({ login: 'carol' });
    await makeUser({ login: 'bob', status: 'pending' });

    expect((await users.list(admin)).map((u) => u.login)).toEqual(['bob', 'zed', 'admin', 'carol']);
  });

  it('없는 사용자면 UserNotFoundError다', async () => {
    await expect(users.activate('no-such-user', admin)).rejects.toThrow(UserNotFoundError);
  });
});
