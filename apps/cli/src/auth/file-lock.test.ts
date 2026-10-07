import { access, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from '../testing/temp-dir.js';
import { LockTimeoutError, withFileLock } from './file-lock.js';

describe('withFileLock', () => {
  it('같은 잠금을 동시에 잡으면 겹치지 않고 하나씩 실행한다', async () => {
    const lock = join(await makeTempDir(), 'refresh.lock');
    let running = 0;
    let maxRunning = 0;
    const work = () =>
      withFileLock(lock, async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await sleep(30);
        running--;
      });

    await Promise.all([work(), work(), work()]);
    expect(maxRunning).toBe(1);
  });

  it('fn의 결과를 돌려주고, 끝나면 잠금 파일을 지운다', async () => {
    const lock = join(await makeTempDir(), 'refresh.lock');
    expect(await withFileLock(lock, async () => 'done')).toBe('done');
    await expect(access(lock)).rejects.toThrow();
  });

  it('fn이 실패해도 잠금을 풀어 다음 실행이 잡을 수 있다', async () => {
    const lock = join(await makeTempDir(), 'refresh.lock');
    await expect(
      withFileLock(lock, async () => {
        throw new Error('갱신 실패');
      }),
    ).rejects.toThrow('갱신 실패');
    expect(await withFileLock(lock, async () => 'ok')).toBe('ok');
  });

  it('죽은 프로세스가 남긴 오래된 잠금 파일은 치우고 잡는다', async () => {
    const lock = join(await makeTempDir(), 'refresh.lock');
    await writeFile(lock, '12345');
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);

    expect(await withFileLock(lock, async () => 'ok', { staleMs: 30_000 })).toBe('ok');
  });

  it('시간 안에 잡지 못하면 LockTimeoutError다', async () => {
    const lock = join(await makeTempDir(), 'refresh.lock');
    await writeFile(lock, 'busy');
    await expect(
      withFileLock(lock, async () => 'never', { timeoutMs: 100, staleMs: 60_000 }),
    ).rejects.toThrow(LockTimeoutError);
  });
});
