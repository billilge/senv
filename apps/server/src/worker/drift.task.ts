import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { type LockOutcome, withNamedLock } from '../database/named-lock.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { SyncService } from '../targets/sync-service.js';

/** 1시간마다 동기화한 적 있는 매핑의 드리프트를 확인한다 (PRD 8.3, 결정 54) */
@Injectable()
export class DriftTask {
  private readonly logger = new Logger(DriftTask.name);

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'target-drift' })
  run(): Promise<LockOutcome<{ checked: number; drifted: number }>> {
    return withNamedLock(this.prisma, 'senv:target-drift', async () => {
      const mappings = await this.prisma.targetMapping.findMany({
        where: { lastSyncedHashes: { not: null } },
        select: { id: true, resourceName: true },
      });
      let drifted = 0;
      for (const mapping of mappings) {
        try {
          if ((await this.sync.checkDrift(mapping.id)).length > 0) drifted++;
        } catch (error) {
          // 한 매핑이 실패해도 나머지는 확인한다
          this.logger.warn(
            `드리프트 확인 실패 (${mapping.resourceName}): ${(error as Error).message}`,
          );
        }
      }
      if (drifted > 0) this.logger.log(`드리프트: ${drifted}/${mappings.length}개 매핑`);
      return { checked: mappings.length, drifted };
    });
  }
}
