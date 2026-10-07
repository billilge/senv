import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing/app.js';

let dir: string;
let t: TestApp;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'senv-dashboard-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>senv</title>');
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  t = await createTestApp({ dashboardDir: dir });
});
afterAll(async () => {
  await t.close();
  await rm(dir, { recursive: true, force: true });
});

describe('대시보드 제공', () => {
  it.each(['/', '/projects/web', '/device?code=BCDF-GHJK', '/admin/users', '/login'])(
    '%s 는 index.html을 주고, 배포가 바로 보이도록 캐시하지 않는다',
    async (path) => {
      const res = await t.http().get(path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('<title>senv</title>');
      expect(res.headers['cache-control']).toBe('no-cache');
    },
  );

  it('빌드된 파일(/assets, 이름에 해시가 있음)은 오래 캐시한다', async () => {
    const res = await t.http().get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('없는 /assets 파일은 index.html이 아니라 404다 (예전 빌드를 연 브라우저가 HTML을 JS로 읽지 않게)', async () => {
    const res = await t.http().get('/assets/index-old999.js');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('<title>senv</title>');
  });

  it('API·로그인·헬스체크 경로는 그대로 서버가 처리한다', async () => {
    const missing = await t.http().get('/api/v1/nope');
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'not_found' });

    expect((await t.http().get('/healthz')).body).toEqual({ status: 'ok' });

    const login = await t.http().get('/auth/github');
    expect(login.status).toBe(302);
    expect(login.headers.location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize/);
  });
});

describe('대시보드 빌드가 없을 때', () => {
  it('정적 파일을 제공하지 않는다 (API만 띄운 로컬 개발)', async () => {
    const apiOnly = await createTestApp();
    try {
      expect((await apiOnly.http().get('/')).status).toBe(404);
    } finally {
      await apiOnly.close();
    }
  });
});
