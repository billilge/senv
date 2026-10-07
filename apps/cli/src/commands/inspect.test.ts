import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestContext, FakeApi, signedIn } from '../testing/fake-api.js';
import { makeTempDir } from '../testing/temp-dir.js';
import { get, KeyNotFoundError, list } from './inspect.js';

const values = (env: string, variables: Record<string, string>) => ({
  status: 200,
  body: { project: 'web', env, version: 3, sharedVersion: 1, variables },
});

async function setup(api: FakeApi) {
  const cwd = await makeTempDir();
  await writeFile(join(cwd, 'senv.json'), JSON.stringify({ project: 'web' }));
  const test = await createTestContext(api, { cwd });
  await signedIn(test.credentials);
  return test;
}

const server = (variables: Record<string, string>, env = 'local') =>
  new FakeApi().reply('GET', `/api/v1/projects/web/envs/${env}/variables`, values(env, variables));

describe('senv list', () => {
  it('키를 이름 순으로 한 줄에 하나씩 내보내고 값은 보여주지 않는다', async () => {
    const { context, logs } = await setup(server({ ZETA: 'secret-z', ALPHA: 'secret-a' }));
    await list(context);
    expect(logs.result).toEqual(['ALPHA\nZETA']);
    expect(JSON.stringify(logs)).not.toContain('secret');
    expect(logs.info.join('\n')).toContain('web/local v3');
  });

  it('값이 하나도 없으면 결과 없이 안내만 한다', async () => {
    const { context, logs } = await setup(server({}));
    await list(context);
    expect(logs.result).toEqual([]);
    expect(logs.info.join('\n')).toContain('없습니다');
  });

  it('--env를 반영한다', async () => {
    const { context, logs } = await setup(server({ PROD_ONLY: 'x' }, 'production'));
    await list(context, { env: 'production' });
    expect(logs.result).toEqual(['PROD_ONLY']);
  });
});

describe('senv get', () => {
  it('값 하나를 그대로 내보낸다 (여러 줄 값도 그대로)', async () => {
    const { context, logs } = await setup(
      server({ KEY: '-----BEGIN-----\nabc\n-----END-----', OTHER: 'x' }),
    );
    await get(context, 'KEY');
    expect(logs.result).toEqual(['-----BEGIN-----\nabc\n-----END-----']);
  });

  it('없는 키면 KeyNotFoundError다', async () => {
    const { context } = await setup(server({ A: '1' }));
    await expect(get(context, 'MISSING')).rejects.toThrow(KeyNotFoundError);
  });
});
