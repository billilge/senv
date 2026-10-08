import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createSenvClient } from '@senv/api-client';
import { describe, expect, it } from 'vitest';
import { main, VERSION } from './program.js';
import { createTestContext, FakeApi, signedIn, TEST_API_URL } from './testing/fake-api.js';
import { makeTempDir } from './testing/temp-dir.js';

const values = (variables: Record<string, string>) => ({
  status: 200,
  body: { project: 'web', env: 'local', version: 3, sharedVersion: 1, variables },
});

async function setup(api = new FakeApi(), options: { login?: boolean } = {}) {
  const cwd = await makeTempDir();
  await promisify(execFile)('git', ['init', '-q'], { cwd });
  await writeFile(join(cwd, 'senv.json'), JSON.stringify({ project: 'web' }));
  await writeFile(join(cwd, '.gitignore'), '.env*\n');
  const test = await createTestContext(api, { cwd, env: { PATH: process.env.PATH } });
  if (options.login !== false) await signedIn(test.credentials);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exec = (...args: string[]) =>
    main(['node', 'senv', ...args], {
      createContext: async () => test.context,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });
  return { ...test, cwd, stdout, stderr, exec };
}

describe('senv 명령줄', () => {
  it('--version은 버전을 보여주고 0으로 끝난다', async () => {
    const { exec, stdout } = await setup();
    expect(await exec('--version')).toBe(0);
    expect(stdout.join('')).toContain('0.1.0');
  });

  it('pull --env --output이 명령에 그대로 전달된다', async () => {
    const api = new FakeApi().reply('GET', '/api/v1/projects/web/envs/production/variables', {
      status: 200,
      body: {
        project: 'web',
        env: 'production',
        version: 1,
        sharedVersion: 0,
        variables: { A: '1' },
      },
    });
    const { exec, cwd } = await setup(api);

    expect(await exec('pull', '--env', 'production', '--output', '.env.production')).toBe(0);
    expect(await readFile(join(cwd, '.env.production'), 'utf8')).toContain('A=1');
  });

  it('run -- <명령>은 자식 명령의 종료 코드로 끝난다', async () => {
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      values({ CODE: '7' }),
    );
    const { exec } = await setup(api);
    expect(
      await exec('run', '--', process.execPath, '-e', 'process.exit(Number(process.env.CODE))'),
    ).toBe(7);
  });

  it('list는 결과를 stdout으로, 안내는 stderr로 보낸다', async () => {
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local/variables',
      values({ B: '2', A: '1' }),
    );
    const { exec, stdout, stderr } = await setup(api);
    expect(await exec('list')).toBe(0);
    expect(stdout.join('')).toBe('A\nB\n');
    expect(stderr.join('')).toContain('web/local v3');
  });

  it('고정 환경이 아닌 --env는 실행하지 않고 2로 끝난다', async () => {
    const { exec, stderr } = await setup();
    expect(await exec('pull', '--env', 'staging')).toBe(2);
    expect(stderr.join('')).toContain('local, development, production');
  });

  it('로그인하지 않았으면 senv login을 안내하고 1로 끝난다', async () => {
    const { exec, stderr } = await setup(new FakeApi(), { login: false });
    expect(await exec('list')).toBe(1);
    expect(stderr.join('')).toContain('senv login');
  });

  it('서버 오류는 메시지와 code를 보여주고 1로 끝난다', async () => {
    const api = new FakeApi().reply('GET', '/api/v1/projects/web/envs/local/variables', {
      status: 409,
      body: { code: 'broken_reference', message: '해석할 수 없는 공유 참조가 있습니다' },
    });
    const { exec, stderr } = await setup(api);
    expect(await exec('list')).toBe(1);
    expect(stderr.join('')).toContain('해석할 수 없는 공유 참조가 있습니다');
    expect(stderr.join('')).toContain('broken_reference');
  });

  it('서버에 닿지 못하면 서버 주소를 알려주고 1로 끝난다', async () => {
    const test = await setup();
    test.context.api = createSenvClient({
      baseUrl: TEST_API_URL,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(await test.exec('list')).toBe(1);
    expect(test.stderr.join('')).toContain(TEST_API_URL);
  });

  it('모르는 명령은 1로 끝난다', async () => {
    const { exec, stderr } = await setup();
    expect(await exec('nope')).toBe(1);
    expect(stderr.join('')).toContain('nope');
  });

  it('set·export·diff·status·push·doctor 명령이 연결돼 있다', async () => {
    const api = new FakeApi()
      .reply('GET', '/api/v1/projects/web/envs/local', {
        status: 200,
        body: { project: 'web', env: 'local', version: 3, variables: { A: '1' } },
      })
      .reply('POST', '/api/v1/projects/web/envs/local/versions', {
        status: 201,
        body: { version: 4, diff: { added: [], removed: [], changed: ['A'], unchanged: [] } },
      })
      .reply('GET', '/api/v1/projects/web/envs/local/variables', {
        ...values({ A: '1' }),
        body: { ...values({ A: '1' }).body, exposure: { exposedSecrets: [], unregistered: [] } },
      })
      .reply('GET', '/api/v1/me', {
        status: 200,
        body: {
          id: 'u1',
          githubId: '1',
          login: 'alice',
          name: null,
          avatarUrl: null,
          role: 'member',
          status: 'active',
        },
      })
      .reply('GET', '/api/v1/projects/web/schema', {
        status: 200,
        body: { publicPrefixes: [], keys: [] },
      });
    const { exec, stdout, stderr, cwd } = await setup(api);

    expect(await exec('set', 'A=2', '--yes', '--message', 'm')).toBe(0);
    expect(api.requests.find((r) => r.method === 'POST')?.body).toEqual({
      baseVersion: 3,
      changes: { set: { A: '2' } },
      message: 'm',
    });

    stdout.length = 0;
    expect(await exec('export', '--format', 'json')).toBe(0);
    expect(JSON.parse(stdout.join(''))).toEqual({ A: '1' });
    expect(await exec('export', '--format', 'xml')).toBe(2);
    expect(await exec('init', '--format', 'xml')).toBe(2);
    expect(await exec('agent', 'restart')).toBe(2);
    expect(await exec('agent', '--interval', '3')).toBe(2);

    await writeFile(join(cwd, '.env.local'), '# senv: web/local v3 (shared v1)\nA=1\n');
    expect(await exec('status')).toBe(0);
    expect(await exec('diff')).toBe(0);
    expect(await exec('push', '--yes')).toBe(0);
    expect(await exec('doctor')).toBe(0);
    expect(stderr.join('')).toMatch(/최신입니다/);
  });

  it('--version은 package.json의 version과 같다 (배포 태그 cli-v<version>과 맞춘다)', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });
});
