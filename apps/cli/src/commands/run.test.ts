import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SenvApiError } from '@senv/api-client';
import { describe, expect, it } from 'vitest';
import { createTestContext, FakeApi, signedIn } from '../testing/fake-api.js';
import { makeTempDir } from '../testing/temp-dir.js';
import { CommandNotFoundError, MissingCommandError, run } from './run.js';

const values = (variables: Record<string, string>) => ({
  status: 200,
  body: { project: 'web', env: 'local', version: 3, sharedVersion: 1, variables },
});

/** 자식 프로세스가 받은 환경변수 중 names를 JSON 파일로 쓰고 exitCode로 끝나는 명령 */
function recordEnv(out: string, names: string[], exitCode = 0) {
  const script = `require('fs').writeFileSync(process.argv[1], JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map((n) => [n, process.env[n]])))); process.exit(${exitCode})`;
  return [process.execPath, '-e', script, out];
}

async function setup(api: FakeApi, env: NodeJS.ProcessEnv = {}) {
  const cwd = await makeTempDir();
  await writeFile(join(cwd, 'senv.json'), JSON.stringify({ project: 'web' }));
  const test = await createTestContext(api, { cwd, env: { PATH: process.env.PATH, ...env } });
  await signedIn(test.credentials);
  return { ...test, cwd };
}

const server = (variables: Record<string, string>) =>
  new FakeApi().reply('GET', '/api/v1/projects/web/envs/local/variables', values(variables));

describe('senv run', () => {
  it('받은 값을 환경변수로 넣어 명령을 실행하고, 명령의 종료 코드를 돌려준다', async () => {
    const { context, cwd } = await setup(server({ API_URL: 'http://api', MODE: 'dev' }));
    const out = join(cwd, 'env.json');

    const exitCode = await run(context, recordEnv(out, ['API_URL', 'MODE'], 3));

    expect(exitCode).toBe(3);
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual({ API_URL: 'http://api', MODE: 'dev' });
  });

  it('셸에서 물려받은 환경변수는 두고, 이름이 같으면 senv 값을 쓴다', async () => {
    const { context, cwd } = await setup(server({ MODE: 'senv' }), {
      KEEP: 'shell',
      MODE: 'shell',
    });
    const out = join(cwd, 'env.json');

    await run(context, recordEnv(out, ['KEEP', 'MODE']));

    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual({ KEEP: 'shell', MODE: 'senv' });
  });

  it('값을 파일로 남기지 않는다', async () => {
    const { context, cwd } = await setup(server({ SECRET: 'x' }));
    await run(context, recordEnv(join(cwd, 'env.json'), ['SECRET']));
    await expect(access(join(cwd, '.env.local'))).rejects.toThrow();
  });

  it('값을 받지 못하면 명령을 실행하지 않는다', async () => {
    const api = new FakeApi().reply('GET', '/api/v1/projects/web/envs/local/variables', {
      status: 409,
      body: { code: 'broken_reference', message: '참조 오류' },
    });
    const { context, cwd } = await setup(api);
    const out = join(cwd, 'env.json');

    await expect(run(context, recordEnv(out, ['A']))).rejects.toThrow(SenvApiError);
    await expect(access(out)).rejects.toThrow();
  });

  it('명령을 주지 않으면 MissingCommandError다', async () => {
    const { context } = await setup(server({}));
    await expect(run(context, [])).rejects.toThrow(MissingCommandError);
  });

  it('없는 명령이면 CommandNotFoundError다', async () => {
    const { context } = await setup(server({}));
    await expect(run(context, ['senv-no-such-command-xyz'])).rejects.toThrow(CommandNotFoundError);
  });

  it('명령이 시그널로 끝나면 128+시그널 번호를 돌려준다 (SIGTERM → 143)', async () => {
    const { context } = await setup(server({}));
    const exitCode = await run(context, [
      process.execPath,
      '-e',
      "process.kill(process.pid, 'SIGTERM')",
    ]);
    expect(exitCode).toBe(143);
  });
});
