import { isUniqueViolation } from '../database/errors.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { GitHubClient, OrgMembership } from './github-client.js';

export interface UserView {
  id: string;
  githubId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  role: 'admin' | 'member';
  status: 'pending' | 'active' | 'disabled';
}

export interface AuthOptions {
  org: string;
  /** 소문자 GitHub 사용자명 */
  bootstrapAdmins: string[];
}

export class NotOrgMemberError extends Error {
  constructor(
    readonly login: string,
    readonly membership: OrgMembership,
  ) {
    super(`${login}은(는) 허용된 GitHub 조직의 활성 멤버가 아닙니다 (${membership})`);
    this.name = 'NotOrgMemberError';
  }
}

export class UserDisabledError extends Error {
  constructor(readonly login: string) {
    super(`비활성화된 사용자입니다: ${login}`);
    this.name = 'UserDisabledError';
  }
}

export const USER_FIELDS = {
  id: true,
  githubId: true,
  login: true,
  name: true,
  avatarUrl: true,
  role: true,
  status: true,
} as const;

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly github: GitHubClient,
    private readonly options: AuthOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * GitHub OAuth 콜백의 code로 로그인한다. org 활성 멤버만 받는다 (PRD 9.2).
   * 처음 로그인하면 승인 대기 멤버가 되고, 첫 관리자 목록에 있으면 바로 활성 관리자가 된다.
   */
  async loginWithGitHub(code: string, redirectUri: string): Promise<UserView> {
    const token = await this.github.exchangeCode(code, redirectUri);
    const gitHubUser = await this.github.getUser(token);
    const membership = await this.github.getOrgMembership(token, this.options.org);
    if (membership !== 'active') throw new NotOrgMemberError(gitHubUser.login, membership);

    // 첫 관리자 목록은 설정이 기준이라, 로그인할 때마다 활성 관리자로 맞춘다
    const isBootstrapAdmin = this.options.bootstrapAdmins.includes(gitHubUser.login.toLowerCase());
    // 관리자가 미리 정해 둔 역할이 있으면 처음 로그인할 때 승인 대기 없이 그 역할이 된다
    const assignment = await this.prisma.roleAssignment.findUnique({
      where: { login: gitHubUser.login.toLowerCase() },
    });
    const profile = {
      login: gitHubUser.login,
      name: gitHubUser.name,
      avatarUrl: gitHubUser.avatarUrl,
      lastLoginAt: this.now(),
    };
    const githubId = String(gitHubUser.id);
    const upsert = () =>
      this.prisma.user.upsert({
        where: { githubId },
        create: {
          githubId,
          ...profile,
          role: isBootstrapAdmin ? 'admin' : (assignment?.role ?? 'member'),
          status: isBootstrapAdmin || assignment ? 'active' : 'pending',
        },
        update: isBootstrapAdmin ? { ...profile, role: 'admin', status: 'active' } : profile,
        select: USER_FIELDS,
      });

    let user: UserView;
    try {
      user = await upsert();
    } catch (error) {
      // 같은 사용자가 동시에 처음 로그인하면 한쪽의 생성이 유니크 제약에 걸린다. 다시 하면 갱신이 된다
      if (!isUniqueViolation(error)) throw error;
      user = await upsert();
    }

    if (assignment) {
      await this.prisma.roleAssignment.deleteMany({ where: { login: assignment.login } });
    }
    if (user.status === 'disabled') throw new UserDisabledError(user.login);
    return user;
  }
}
