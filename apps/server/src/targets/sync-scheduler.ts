import type { Prisma } from '../generated/prisma/client.js';
import type { JobsService } from '../jobs/jobs-service.js';
import type { PublishEvent, PublishListener } from '../publishing/publish-service.js';

export const SYNC_JOB = 'target.sync';

export interface SyncJobPayload {
  mappingId: string;
}

/**
 * 게시하면 자동 매핑의 동기화 작업을 같은 트랜잭션에서 등록한다 (PRD 4.4, 결정 53).
 * 공유 그룹을 게시하면 그 환경의 모든 자동 매핑에 등록한다. 같은 매핑의 대기 작업은 대체한다.
 */
export class SyncScheduler implements PublishListener {
  constructor(private readonly jobs: JobsService) {}

  async onPublished(tx: Prisma.TransactionClient, event: PublishEvent): Promise<void> {
    const mappings = await tx.targetMapping.findMany({
      where: {
        env: event.env,
        syncMode: 'auto',
        ...(event.kind === 'shared' ? {} : { project: { name: event.project } }),
      },
      select: { id: true },
    });
    for (const mapping of mappings) {
      await this.jobs.enqueue(tx, {
        type: SYNC_JOB,
        payload: { mappingId: mapping.id } satisfies SyncJobPayload,
        dedupeKey: `${SYNC_JOB}:${mapping.id}`,
      });
    }
  }
}
