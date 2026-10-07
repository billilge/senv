import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { FakeGitHubClient } from '../testing/fake-github.js';
import { AuthService, NotOrgMemberError, UserDisabledError } from './auth-service.js';
import { GitHubAuthError, GitHubUnavailableError } from './github-client.js';

const prisma = createTestPrisma();
const NOW = new Date('2026-10-07T09:00:00.000Z');
const REDIRECT = 'http://localhost:3000/auth/github/callback';

const alice = { id: 1001, login: 'Alice', name: 'Alice Kim', avatarUrl: 'https://a/1.png' };
const bob = { id: 1002, login: 'bob', name: null, avatarUrl: null };

let github: FakeGitHubClient;
let auth: AuthService;

beforeEach(async () => {
  await resetDatabase(prisma);
  github = new FakeGitHubClient();
  github.addUser('code-alice', alice);
  github.addUser('code-bob', bob);
  auth = new AuthService(
    prisma,
    github,
    { org: 'billilge', bootstrapAdmins: ['alice'] },
    () => NOW,
  );
});
afterAll(() => prisma.$disconnect());

describe('AuthService.loginWithGitHub', () => {
  it('org 활성 멤버가 처음 로그인하면 승인 대기 멤버로 만든다', async () => {
    const user = await auth.loginWithGitHub('code-bob', REDIRECT);

    expect(user).toMatchObject({
      githubId: '1002',
      login: 'bob',
      role: 'member',
      status: 'pending',
    });
    const row = await prisma.user.findUniqueOrThrow({ where: { githubId: '1002' } });
    expect(row.lastLoginAt).toEqual(NOW);
  });

  it('SENV_BOOTSTRAP_ADMINS에 있으면 처음 로그인하자마자 활성 관리자다 (대소문자 무시)', async () => {
    expect(await auth.loginWithGitHub('code-alice', REDIRECT)).toMatchObject({
      login: 'Alice',
      name: 'Alice Kim',
      avatarUrl: 'https://a/1.png',
      role: 'admin',
      status: 'active',
    });
  });

  it('다시 로그인하면 GitHub 정보를 갱신하고 역할·상태는 그대로 둔다', async () => {
    await auth.loginWithGitHub('code-bob', REDIRECT);
    await prisma.user.update({ where: { githubId: '1002' }, data: { status: 'active' } });
    github.addUser('code-bob', { ...bob, login: 'bob-renamed', name: 'Bob' });

    expect(await auth.loginWithGitHub('code-bob', REDIRECT)).toMatchObject({
      githubId: '1002',
      login: 'bob-renamed',
      name: 'Bob',
      role: 'member',
      status: 'active',
    });
    expect(await prisma.user.count()).toBe(1);
  });

  it.each(['none', 'pending'] as const)(
    'org 멤버십이 %s 이면 NotOrgMemberError이고 사용자를 만들지 않는다',
    async (membership) => {
      github.setMembership(bob.id, membership);
      await expect(auth.loginWithGitHub('code-bob', REDIRECT)).rejects.toThrow(NotOrgMemberError);
      expect(await prisma.user.count()).toBe(0);
    },
  );

  it('비활성화된 사용자는 로그인할 수 없다', async () => {
    await auth.loginWithGitHub('code-bob', REDIRECT);
    await prisma.user.update({ where: { githubId: '1002' }, data: { status: 'disabled' } });
    await expect(auth.loginWithGitHub('code-bob', REDIRECT)).rejects.toThrow(UserDisabledError);
  });

  it('첫 관리자 목록에 있는 사용자는 비활성화돼 있어도 로그인하면 활성 관리자로 되돌린다', async () => {
    await auth.loginWithGitHub('code-alice', REDIRECT);
    await prisma.user.update({
      where: { githubId: '1001' },
      data: { status: 'disabled', role: 'member' },
    });
    expect(await auth.loginWithGitHub('code-alice', REDIRECT)).toMatchObject({
      role: 'admin',
      status: 'active',
    });
  });

  it('같은 사용자가 동시에 처음 로그인해도 사용자는 하나만 생긴다', async () => {
    await Promise.all([
      auth.loginWithGitHub('code-bob', REDIRECT),
      auth.loginWithGitHub('code-bob', REDIRECT),
      auth.loginWithGitHub('code-bob', REDIRECT),
    ]);
    expect(await prisma.user.count()).toBe(1);
  });

  it('잘못된 code면 GitHubAuthError를 그대로 전달한다', async () => {
    await expect(auth.loginWithGitHub('wrong', REDIRECT)).rejects.toThrow(GitHubAuthError);
  });

  it('GitHub 장애면 GitHubUnavailableError를 전달하고 사용자를 바꾸지 않는다', async () => {
    await auth.loginWithGitHub('code-bob', REDIRECT);
    github.unavailable = true;
    await expect(auth.loginWithGitHub('code-bob', REDIRECT)).rejects.toThrow(
      GitHubUnavailableError,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { githubId: '1002' } })).status).toBe(
      'pending',
    );
  });
});
