import type { PrismaClient } from '../generated/prisma/client.js';
import { USER_FIELDS, type UserView } from './auth-service.js';
import { hashToken, issueToken, tokenKindOf } from './tokens.js';

export interface CreatedSession {
  /** 쿠키에 넣을 원문 토큰 (senv_ss_…) */
  token: string;
  expiresAt: Date;
}

/** 마지막 사용 후 이 기간이 지나면 만료 (PRD 9.2) */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 요청마다 DB에 쓰지 않도록, 마지막 갱신 후 이만큼 지났을 때만 연장한다 */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export class SessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(userId: string): Promise<CreatedSession> {
    const { token, hash } = issueToken('session');
    const now = this.now();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await this.prisma.session.create({
      data: { userId, tokenHash: hash, createdAt: now, lastUsedAt: now, expiresAt },
    });
    return { token, expiresAt };
  }

  /** 유효한 세션이면 사용자를, 아니면 null을 돌려준다. 승인 대기 사용자도 돌려준다 */
  async authenticate(token: string): Promise<UserView | null> {
    if (tokenKindOf(token) !== 'session') return null;
    const tokenHash = hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      select: { id: true, lastUsedAt: true, expiresAt: true, user: { select: USER_FIELDS } },
    });
    if (!session) return null;

    const now = this.now();
    if (session.expiresAt <= now) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    if (session.user.status === 'disabled') return null;

    if (now.getTime() - session.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) },
      });
    }
    return session.user;
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }
}
