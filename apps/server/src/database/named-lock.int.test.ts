import { afterAll, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../testing/database.js';
import { withNamedLock } from './named-lock.js';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('withNamedLock (MySQL GET_LOCK)', () => {
  it('잠금을 얻으면 일을 하고 결과를 돌려준다', async () => {
    expect(await withNamedLock(prisma, 'senv:test', async () => 42)).toEqual({
      ran: true,
      result: 42,
    });
  });

  it('다른 쪽이 잠금을 쥐고 있으면 기다리지 않고 건너뛴다', async () => {
    const holding = deferred();
    const started = deferred();
    const first = withNamedLock(prisma, 'senv:test', async () => {
      started.resolve();
      await holding.promise;
      return 'first';
    });
    await started.promise;

    let ranSecond = false;
    const second = await withNamedLock(prisma, 'senv:test', async () => {
      ranSecond = true;
    });
    expect(second).toEqual({ ran: false });
    expect(ranSecond).toBe(false);

    holding.resolve();
    expect(await first).toEqual({ ran: true, result: 'first' });
  });

  it('일이 실패해도 잠금을 풀어서 다음 실행은 된다', async () => {
    await expect(
      withNamedLock(prisma, 'senv:test', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await withNamedLock(prisma, 'senv:test', async () => 'again')).toEqual({
      ran: true,
      result: 'again',
    });
  });

  it('이름이 다르면 서로 막지 않는다', async () => {
    const holding = deferred();
    const started = deferred();
    const first = withNamedLock(prisma, 'senv:a', async () => {
      started.resolve();
      await holding.promise;
    });
    await started.promise;

    expect(await withNamedLock(prisma, 'senv:b', async () => 'b')).toEqual({
      ran: true,
      result: 'b',
    });
    holding.resolve();
    await first;
  });
});
