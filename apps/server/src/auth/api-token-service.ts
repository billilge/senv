import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { USER_FIELDS, type UserView } from './auth-service.js';
import { hashToken, issueToken, tokenKindOf } from './tokens.js';

export interface TokenPair {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super('refresh 토큰이 유효하지 않습니다. 다시 로그인하세요 (senv login)');
    this.name = 'InvalidRefreshTokenError';
  }
}

export class RefreshTokenReusedError extends Error {
  constructor() {
    super(
      '이미 쓴 refresh 토큰이 다시 쓰였습니다. 안전을 위해 이 사용자의 토큰을 모두 폐기했습니다',
    );
    this.name = 'RefreshTokenReusedError';
  }
}

const HOUR_MS = 60 * 60 * 1000;
const ACCESS_TTL_MS = HOUR_MS;
const REFRESH_TTL_MS = 30 * 24 * HOUR_MS;

/** CLI가 쓰는 access(1시간)·refresh(30일) 토큰 (PRD 9.2) */
export class ApiTokenService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issuePair(userId: string): Promise<TokenPair> {
    return this.insertPair(this.prisma, userId, this.now());
  }

  /** 유효한 access 토큰이면 사용자를, 아니면 null을 돌려준다 */
  async authenticate(accessToken: string): Promise<UserView | null> {
    if (tokenKindOf(accessToken) !== 'access') return null;
    const row = await this.prisma.apiToken.findUnique({
      where: { tokenHash: hashToken(accessToken) },
      select: { kind: true, expiresAt: true, revokedAt: true, user: { select: USER_FIELDS } },
    });
    if (row?.kind !== 'access' || row.revokedAt || row.expiresAt <= this.now()) return null;
    if (row.user.status === 'disabled') return null;
    return row.user;
  }

  /**
   * refresh 토큰을 새 쌍으로 바꾼다. 쓴 refresh 토큰이 다시 오면 탈취로 보고
   * 그 사용자의 토큰을 모두 폐기한다. 같은 토큰을 동시에 쓰는 경우도 재사용으로 본다.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    if (tokenKindOf(refreshToken) !== 'refresh') throw new InvalidRefreshTokenError();
    const row = await this.prisma.apiToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      select: {
        id: true,
        kind: true,
        userId: true,
        expiresAt: true,
        user: { select: { status: true } },
      },
    });
    const now = this.now();
    if (row?.kind !== 'refresh') throw new InvalidRefreshTokenError();
    if (row.expiresAt <= now || row.user.status === 'disabled')
      throw new InvalidRefreshTokenError();

    // 토큰 행을 잠가서, 동시에 온 두 번째 요청은 첫 번째가 새 쌍까지 커밋한 뒤에 재사용을 보게 한다
    const outcome = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ revoked_at: Date | null }[]>`
        SELECT revoked_at FROM api_tokens WHERE id = ${row.id} FOR UPDATE`;
      if (locked?.revoked_at) return { reused: true } as const;
      await tx.apiToken.update({ where: { id: row.id }, data: { revokedAt: now } });
      return { reused: false, pair: await this.insertPair(tx, row.userId, now) } as const;
    });

    if (outcome.reused) {
      // 트랜잭션 밖에서 폐기해야 오류를 던져도 폐기가 되돌려지지 않는다
      await this.revokeAllForUser(row.userId);
      throw new RefreshTokenReusedError();
    }
    return outcome.pair;
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.apiToken.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: this.now() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.apiToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.now() },
    });
  }

  private async insertPair(
    client: PrismaClient | Prisma.TransactionClient,
    userId: string,
    now: Date,
  ): Promise<TokenPair> {
    const access = issueToken('access');
    const refresh = issueToken('refresh');
    const accessExpiresAt = new Date(now.getTime() + ACCESS_TTL_MS);
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
    await client.apiToken.createMany({
      data: [
        {
          userId,
          kind: 'access',
          tokenHash: access.hash,
          createdAt: now,
          expiresAt: accessExpiresAt,
        },
        {
          userId,
          kind: 'refresh',
          tokenHash: refresh.hash,
          createdAt: now,
          expiresAt: refreshExpiresAt,
        },
      ],
    });
    return {
      accessToken: access.token,
      accessExpiresAt,
      refreshToken: refresh.token,
      refreshExpiresAt,
    };
  }
}
