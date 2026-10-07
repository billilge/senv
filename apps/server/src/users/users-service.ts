import type { ApiTokenService } from '../auth/api-token-service.js';
import { USER_FIELDS, type UserView } from '../auth/auth-service.js';
import type { SessionService } from '../auth/session-service.js';
import type { PrismaClient } from '../generated/prisma/client.js';

export class AdminRequiredError extends Error {
  constructor() {
    super('관리자만 할 수 있습니다');
    this.name = 'AdminRequiredError';
  }
}

export class UserNotFoundError extends Error {
  constructor(readonly userId: string) {
    super(`사용자가 없습니다: ${userId}`);
    this.name = 'UserNotFoundError';
  }
}

export class CannotDisableSelfError extends Error {
  constructor() {
    super('자기 자신은 비활성화할 수 없습니다');
    this.name = 'CannotDisableSelfError';
  }
}

export class LastAdminError extends Error {
  constructor() {
    super('마지막 활성 관리자는 강등하거나 비활성화할 수 없습니다');
    this.name = 'LastAdminError';
  }
}

export class UserAlreadyExistsError extends Error {
  constructor(readonly login: string) {
    super(`이미 로그인한 사용자입니다. 사용자 목록에서 역할을 바꾸세요: ${login}`);
    this.name = 'UserAlreadyExistsError';
  }
}

export class InvalidGitHubLoginError extends Error {
  constructor(readonly login: string) {
    super(`GitHub 사용자명 형식이 아닙니다: ${JSON.stringify(login)}`);
    this.name = 'InvalidGitHubLoginError';
  }
}

export class AssignmentNotFoundError extends Error {
  constructor(readonly login: string) {
    super(`미리 지정한 역할이 없습니다: ${login}`);
    this.name = 'AssignmentNotFoundError';
  }
}

export interface RoleAssignmentView {
  login: string;
  role: 'admin' | 'member';
  createdAt: Date;
}

/** GitHub 사용자명: 영숫자와 하이픈(연속·앞뒤 불가), 39자 이하 */
const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/** 관리자의 사용자 관리 (M1: 승인, 비활성화, 역할 변경, 역할 미리 지정) */
export class UsersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sessions: SessionService,
    private readonly tokens: ApiTokenService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listAssignments(actor: UserView): Promise<RoleAssignmentView[]> {
    requireAdmin(actor);
    return this.prisma.roleAssignment.findMany({
      orderBy: { login: 'asc' },
      select: { login: true, role: true, createdAt: true },
    });
  }

  /** 아직 로그인하지 않은 GitHub 사용자의 역할을 정해 둔다. 처음 로그인할 때 바로 활성화된다 */
  async assignRole(
    login: string,
    role: 'admin' | 'member',
    actor: UserView,
  ): Promise<RoleAssignmentView> {
    requireAdmin(actor);
    if (!GITHUB_LOGIN.test(login)) throw new InvalidGitHubLoginError(login);
    const normalized = login.toLowerCase();
    const existing = await this.prisma.user.findMany({ select: { login: true } });
    if (existing.some((user) => user.login.toLowerCase() === normalized)) {
      throw new UserAlreadyExistsError(login);
    }
    const fields = { role, createdBy: actor.id, createdAt: this.now() };
    return this.prisma.roleAssignment.upsert({
      where: { login: normalized },
      create: { login: normalized, ...fields },
      update: fields,
      select: { login: true, role: true, createdAt: true },
    });
  }

  async removeAssignment(login: string, actor: UserView): Promise<void> {
    requireAdmin(actor);
    const { count } = await this.prisma.roleAssignment.deleteMany({
      where: { login: login.toLowerCase() },
    });
    if (count === 0) throw new AssignmentNotFoundError(login);
  }

  /** 승인 대기 사용자를 먼저, 그다음 사용자명 순으로 돌려준다 */
  async list(actor: UserView): Promise<UserView[]> {
    requireAdmin(actor);
    const rows = await this.prisma.user.findMany({ select: USER_FIELDS });
    const rank = (user: UserView) => (user.status === 'pending' ? 0 : 1);
    return rows.sort((a, b) => rank(a) - rank(b) || a.login.localeCompare(b.login, 'en'));
  }

  /** 승인 대기나 비활성 사용자를 활성으로 만든다 */
  async activate(userId: string, actor: UserView): Promise<UserView> {
    requireAdmin(actor);
    await this.find(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: { status: 'active' },
      select: USER_FIELDS,
    });
  }

  /** 비활성화하고 세션과 CLI 토큰을 즉시 폐기한다 (PRD 3.2 시나리오 5) */
  async disable(userId: string, actor: UserView): Promise<UserView> {
    requireAdmin(actor);
    if (userId === actor.id) throw new CannotDisableSelfError();
    const target = await this.find(userId);
    if (isActiveAdmin(target)) await this.assertAnotherActiveAdmin(userId);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'disabled' },
      select: USER_FIELDS,
    });
    await this.sessions.revokeAllForUser(userId);
    await this.tokens.revokeAllForUser(userId);
    return user;
  }

  async setRole(userId: string, role: 'admin' | 'member', actor: UserView): Promise<UserView> {
    requireAdmin(actor);
    const target = await this.find(userId);
    if (role === 'member' && isActiveAdmin(target)) await this.assertAnotherActiveAdmin(userId);
    return this.prisma.user.update({ where: { id: userId }, data: { role }, select: USER_FIELDS });
  }

  private async find(userId: string): Promise<UserView> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_FIELDS });
    if (!user) throw new UserNotFoundError(userId);
    return user;
  }

  /** 이 사용자 말고도 활성 관리자가 있어야 한다. 관리자가 아무도 없는 상태를 막는다 */
  private async assertAnotherActiveAdmin(userId: string): Promise<void> {
    const others = await this.prisma.user.count({
      where: { role: 'admin', status: 'active', id: { not: userId } },
    });
    if (others === 0) throw new LastAdminError();
  }
}

function requireAdmin(actor: UserView): void {
  if (!isActiveAdmin(actor)) throw new AdminRequiredError();
}

function isActiveAdmin(user: UserView): boolean {
  return user.role === 'admin' && user.status === 'active';
}
