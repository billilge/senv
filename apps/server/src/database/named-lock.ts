import type { PrismaClient } from '../generated/prisma/client.js';

export type LockOutcome<T> = { ran: true; result: T } | { ran: false };

/** 잠금을 쥔 채로 일할 수 있는 최대 시간 */
const MAX_HOLD_MS = 10 * 60 * 1000;

/**
 * MySQL 이름 잠금(GET_LOCK)을 얻었을 때만 일을 한다. 다른 쪽이 쥐고 있으면 기다리지 않고 건너뛴다.
 * 이름 잠금은 연결 단위라서, 얻고 푸는 쿼리가 같은 연결에서 돌도록 트랜잭션 안에서 실행한다.
 */
export async function withNamedLock<T>(
  prisma: PrismaClient,
  name: string,
  work: () => Promise<T>,
): Promise<LockOutcome<T>> {
  return prisma.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<{ acquired: bigint | number | null }[]>`
        SELECT GET_LOCK(${name}, 0) AS acquired`;
      if (Number(row?.acquired) !== 1) return { ran: false };
      try {
        return { ran: true, result: await work() };
      } finally {
        await tx.$queryRaw`SELECT RELEASE_LOCK(${name})`;
      }
    },
    { timeout: MAX_HOLD_MS },
  );
}
