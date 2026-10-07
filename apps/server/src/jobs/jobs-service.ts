import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

export interface ClaimedJob {
  id: string;
  type: string;
  payload: unknown;
  /** 이번까지 몇 번째 실행인지 (1부터) */
  attempts: number;
}

/** 실행 중인 작업을 이만큼 잠근다. 지나도 끝나지 않으면 worker가 죽은 것으로 보고 다시 대기로 돌린다 */
const LOCK_MS = 60_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 10_000;

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * MySQL `jobs` 테이블 작업 큐 (PRD 4.4, 결정 53). Redis 없이 SKIP LOCKED로 가져가고,
 * 실패하면 지수 백오프로 3회까지 다시 한다.
 */
export class JobsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * 작업을 등록한다. 게시와 같은 트랜잭션에서 부를 수 있게 클라이언트를 받는다.
   * 같은 dedupeKey의 대기 작업은 새 작업으로 대체한다.
   */
  async enqueue(
    client: Client,
    input: { type: string; payload: unknown; dedupeKey?: string; runAt?: Date },
  ): Promise<void> {
    const now = this.now();
    if (input.dedupeKey) {
      await client.job.deleteMany({ where: { dedupeKey: input.dedupeKey, status: 'pending' } });
    }
    await client.job.create({
      data: {
        type: input.type,
        payload: JSON.stringify(input.payload),
        dedupeKey: input.dedupeKey ?? null,
        runAt: input.runAt ?? now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  /** 실행할 때가 된 대기 작업 하나를 가져가 실행 중으로 만든다. 없으면 null */
  async claim(): Promise<ClaimedJob | null> {
    const now = this.now();
    return this.prisma.$transaction(async (tx) => {
      // (status, run_at) 인덱스 순서로 읽어야 한 행만 잠근다. 정렬을 따로 하면 읽은 행을 모두 잠가
      // 다른 worker가 아무것도 가져가지 못한다
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM jobs
        WHERE status = 'pending' AND run_at <= ${now}
        ORDER BY run_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      if (!row) return null;
      const job = await tx.job.update({
        where: { id: row.id },
        data: {
          status: 'running',
          lockedUntil: new Date(now.getTime() + LOCK_MS),
          attempts: { increment: 1 },
          updatedAt: now,
        },
      });
      return {
        id: job.id,
        type: job.type,
        payload: JSON.parse(job.payload),
        attempts: job.attempts,
      };
    });
  }

  async complete(id: string): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: { status: 'done', lockedUntil: null, updatedAt: this.now() },
    });
  }

  /** 3회째 실패면 멈추고, 아니면 10초·20초 뒤로 미룬다 */
  async fail(id: string, error: Error): Promise<void> {
    const now = this.now();
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id } });
    const exhausted = job.attempts >= MAX_ATTEMPTS;
    await this.prisma.job.update({
      where: { id },
      data: {
        status: exhausted ? 'failed' : 'pending',
        runAt: exhausted
          ? job.runAt
          : new Date(now.getTime() + BACKOFF_MS * 2 ** (job.attempts - 1)),
        lockedUntil: null,
        lastError: error.message.slice(0, 1000),
        updatedAt: now,
      },
    });
  }

  /** 잠금 시간이 지난 실행 중 작업을 대기로 돌린다 (worker가 실행 중에 죽은 경우) */
  async recoverStale(): Promise<number> {
    const now = this.now();
    const { count } = await this.prisma.job.updateMany({
      where: { status: 'running', lockedUntil: { lt: now } },
      data: { status: 'pending', lockedUntil: null, updatedAt: now },
    });
    return count;
  }
}
