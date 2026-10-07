import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { type LockOutcome, withNamedLock } from '../database/named-lock.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { type CleanupResult, CleanupService } from '../maintenance/cleanup-service.js';

@Injectable()
export class CleanupTask {
  private readonly logger = new Logger(CleanupTask.name);

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(CleanupService) private readonly cleanup: CleanupService,
  ) {}

  // worker는 하나만 띄우지만, 배포가 겹칠 때를 대비해 이름 잠금으로 한 번 더 막는다 (PRD 4.5)
  @Cron(CronExpression.EVERY_HOUR, { name: 'cleanup-expired' })
  async run(): Promise<LockOutcome<CleanupResult>> {
    const outcome = await withNamedLock(this.prisma, 'senv:cleanup-expired', () =>
      this.cleanup.removeExpired(),
    );
    if (outcome.ran) {
      const { sessions, apiTokens, deviceCodes } = outcome.result;
      this.logger.log(
        `만료 기록 정리: 세션 ${sessions}, 토큰 ${apiTokens}, 디바이스 코드 ${deviceCodes}`,
      );
    }
    return outcome;
  }
}
