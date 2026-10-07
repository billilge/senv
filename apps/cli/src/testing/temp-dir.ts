import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const created: string[] = [];

/** 테스트마다 새 임시 폴더를 만들고, 테스트가 끝나면 지운다 */
export async function makeTempDir(): Promise<string> {
  // macOS의 /var → /private/var 같은 심볼릭 링크를 풀어 경로 비교가 어긋나지 않게 한다
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'senv-test-')));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
