import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { makeTempDir } from './temp-dir.js';

/** senv.json과 .gitignore(.env*)가 있는 git 저장소 */
export async function webRepo(config: Record<string, unknown> = { project: 'web' }) {
  const dir = await makeTempDir();
  await promisify(execFile)('git', ['init', '-q'], { cwd: dir });
  await writeFile(join(dir, 'senv.json'), JSON.stringify(config));
  await writeFile(join(dir, '.gitignore'), '.env*\n');
  return dir;
}

/** 서버가 pull·run에 주는 값 (노출 검사 결과 포함) */
export const delivered = (
  env: string,
  variables: Record<string, string>,
  extra: Record<string, unknown> = {},
) => ({
  status: 200,
  body: {
    project: 'web',
    env,
    version: 3,
    sharedVersion: 1,
    variables,
    exposure: { exposedSecrets: [], unregistered: [] },
    ...extra,
  },
});

/** 편집용 원래 값 (공유 참조를 풀기 전) */
export const raw = (env: string, variables: Record<string, string>, version = 3) => ({
  status: 200,
  body: { project: 'web', env, version, variables },
});
