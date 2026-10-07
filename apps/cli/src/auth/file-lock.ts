import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export class LockTimeoutError extends Error {
  constructor(readonly path: string) {
    super(`다른 senv 프로세스가 잠금을 오래 잡고 있습니다: ${path}`);
    this.name = 'LockTimeoutError';
  }
}

export interface FileLockOptions {
  /** 이 시간 안에 못 잡으면 LockTimeoutError */
  timeoutMs?: number;
  /** 이보다 오래된 잠금 파일은 죽은 프로세스가 남긴 것으로 보고 치운다 */
  staleMs?: number;
}

const RETRY_MS = 25;

/**
 * 여러 senv 프로세스 사이에서 fn을 한 번에 하나씩만 실행한다.
 * 잠금은 파일을 배타적으로 만드는 것(O_EXCL)으로 잡는다.
 */
export async function withFileLock<T>(
  path: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const { timeoutMs = 10_000, staleMs = 30_000 } = options;
  const deadline = Date.now() + timeoutMs;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  for (;;) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await isStale(path, staleMs)) {
        await rm(path, { force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new LockTimeoutError(path);
      await sleep(RETRY_MS);
    }
  }

  try {
    return await fn();
  } finally {
    await rm(path, { force: true });
  }
}

async function isStale(path: string, staleMs: number): Promise<boolean> {
  try {
    return Date.now() - (await stat(path)).mtimeMs > staleMs;
  } catch {
    // 그 사이 다른 프로세스가 지웠다. 다시 잡아 보면 된다
    return false;
  }
}
