import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { type ClaimedJob, JobsService } from '../jobs/jobs-service.js';
import { MappingNotFoundError } from '../targets/mappings-service.js';
import { SYNC_JOB, type SyncJobPayload } from '../targets/sync-scheduler.js';
import { SyncService } from '../targets/sync-service.js';

/** 한 번 깨어날 때 처리할 최대 작업 수 (나머지는 다음 차례에) */
const BATCH = 10;

/** 게시로 등록된 배포 대상 동기화 작업을 2초마다 처리한다 (PRD 4.4, 결정 53) */
@Injectable()
export class SyncJobTask {
  private readonly logger = new Logger(SyncJobTask.name);
  private running = false;

  constructor(
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  /** 처리한 작업 수를 돌려준다. 이전 차례가 아직 돌고 있으면 건너뛴다 */
  @Interval('target-jobs', 2000)
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      await this.jobs.recoverStale();
      let handled = 0;
      while (handled < BATCH) {
        const job = await this.jobs.claim();
        if (!job) break;
        await this.handle(job);
        handled++;
      }
      return handled;
    } finally {
      this.running = false;
    }
  }

  private async handle(job: ClaimedJob): Promise<void> {
    try {
      if (job.type !== SYNC_JOB) throw new Error(`알 수 없는 작업입니다: ${job.type}`);
      const { mappingId } = job.payload as SyncJobPayload;
      await this.sync.sync(mappingId, { trigger: 'publish', attempt: job.attempts });
      await this.jobs.complete(job.id);
    } catch (error) {
      // 매핑이 그 사이 지워졌으면 할 일이 없다
      if (error instanceof MappingNotFoundError) {
        await this.jobs.complete(job.id);
        return;
      }
      await this.jobs.fail(job.id, error as Error);
      this.logger.warn(`동기화 실패 (${job.attempts}번째): ${(error as Error).message}`);
    }
  }
}
