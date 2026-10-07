import type { PrismaClient } from '../generated/prisma/client.js';

export interface CleanupResult {
  sessions: number;
  apiTokens: number;
  deviceCodes: number;
}

/**
 * 만료된 세션·토큰·디바이스 코드를 지운다 (worker가 1시간마다 실행).
 * 폐기된 refresh 토큰도 만료 전에는 재사용 감지에 쓰이므로 남긴다.
 * 만료된 refresh 토큰은 재사용 여부를 보기 전에 거절되므로 지워도 된다.
 */
export class CleanupService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async removeExpired(): Promise<CleanupResult> {
    const expired = { expiresAt: { lte: this.now() } };
    const [sessions, apiTokens, deviceCodes] = await this.prisma.$transaction([
      this.prisma.session.deleteMany({ where: expired }),
      this.prisma.apiToken.deleteMany({ where: expired }),
      this.prisma.deviceCode.deleteMany({ where: expired }),
    ]);
    return { sessions: sessions.count, apiTokens: apiTokens.count, deviceCodes: deviceCodes.count };
  }
}
