import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestContext, FakeApi, signedIn } from '../testing/fake-api.js';
import { delivered, webRepo } from '../testing/repo.js';
import { diff, status } from './compare.js';

async function setup(api: FakeApi, root: string) {
  const test = await createTestContext(api, { cwd: root });
  await signedIn(test.credentials);
  return test;
}

const pulledFile = (version: number, shared: number, body: string) =>
  `# senv: web/local v${version} (shared v${shared})\n# generated: 2026-10-07\n${body}`;

describe('senv status', () => {
  it('로컬 파일 버전이 서버와 같으면 최신이라고 알린다', async () => {
    const root = await webRepo();
    await writeFile(join(root, '.env.local'), pulledFile(3, 1, 'A=1\n'));
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      delivered('local', { A: '1' }),
    );
    const { context, logs } = await setup(api, root);

    await status(context);
    expect(logs.info.join('\n')).toMatch(/web\/local v3 \(shared v1\).*최신/);
  });

  it('서버가 더 새로우면 버전을 보여주고 pull을 권한다', async () => {
    const root = await webRepo();
    await writeFile(join(root, '.env.local'), pulledFile(2, 1, 'A=1\n'));
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      delivered('local', { A: '1' }),
    );
    const { context, logs } = await setup(api, root);

    await status(context);
    expect(logs.info.join('\n')).toMatch(/로컬 v2 \(shared v1\).*서버 v3 \(shared v1\).*senv pull/);
  });

  it('받은 파일이 없으면 pull하라고 알린다', async () => {
    const root = await webRepo();
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      delivered('local', {}),
    );
    const { context, logs } = await setup(api, root);

    await status(context);
    expect(logs.info.join('\n')).toMatch(/\.env\.local.*없습니다.*senv pull/);
  });
});

describe('senv diff', () => {
  it('로컬 파일과 서버 값의 차이를 키 이름으로만 보여준다 (값은 보여주지 않는다)', async () => {
    const root = await webRepo();
    await writeFile(
      join(root, '.env.local'),
      pulledFile(3, 1, 'SAME=1\nCHANGED=old-secret\nLOCAL_ONLY=x\n'),
    );
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      delivered('local', { SAME: '1', CHANGED: 'new-secret', SERVER_ONLY: 'y' }),
    );
    const { context, logs } = await setup(api, root);

    await diff(context);

    expect(logs.result).toEqual(['+ SERVER_ONLY\n- LOCAL_ONLY\n~ CHANGED']);
    expect([...logs.info, ...logs.result].join('\n')).not.toMatch(/secret/);
  });

  it('같으면 같다고 알린다', async () => {
    const root = await webRepo();
    await writeFile(join(root, '.env.local'), pulledFile(3, 1, 'A=1\n'));
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      delivered('local', { A: '1' }),
    );
    const { context, logs } = await setup(api, root);

    await diff(context);
    expect(logs.result).toEqual([]);
    expect(logs.info.join('\n')).toMatch(/같습니다/);
  });
});

describe('properties 형식', () => {
  it('status는 기본 출력 파일(.env.local.properties)의 머리글을 읽는다', async () => {
    const root = await webRepo({ project: 'web', format: 'properties' });
    await writeFile(join(root, '.env.local.properties'), pulledFile(3, 1, 'A=1\n'));
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      delivered('local', { A: '1' }),
    );
    const { context, logs } = await setup(api, root);

    await status(context);
    expect(logs.info.join('\n')).toMatch(/최신입니다/);
  });

  it('diff는 properties 규칙(이스케이프·\\u)으로 읽어 비교한다', async () => {
    const root = await webRepo({ project: 'web', format: 'properties' });
    await writeFile(
      join(root, '.env.local.properties'),
      pulledFile(3, 1, 'DB_URL=jdbc\\:mysql://db\\:3306\nGREETING=\\uC548\\uB155\nOLD=1\n'),
    );
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      delivered('local', { DB_URL: 'jdbc:mysql://db:3306', GREETING: '안녕', NEW: 'x' }),
    );
    const { context, logs } = await setup(api, root);

    await diff(context);
    expect(logs.result).toEqual(['+ NEW\n- OLD']);
  });
});
