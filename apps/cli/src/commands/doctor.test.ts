import { describe, expect, it } from 'vitest';
import { createTestContext, FakeApi, signedIn } from '../testing/fake-api.js';
import { delivered, webRepo } from '../testing/repo.js';
import { makeTempDir } from '../testing/temp-dir.js';
import { doctor } from './doctor.js';

const me = {
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
};
const schema = (keys: unknown[]) => ({ status: 200, body: { publicPrefixes: ['VITE_'], keys } });
const key = (name: string, fields: Record<string, unknown>) => ({
  key: name,
  type: 'string',
  visibility: 'secret',
  required: false,
  optionalIn: [],
  buildTime: false,
  description: '',
  ...fields,
});

describe('senv doctor', () => {
  it('모두 괜찮으면 0을 돌려준다', async () => {
    const root = await webRepo();
    const api = new FakeApi()
      .reply('GET', '/api/v1/me', me)
      .reply(
        'GET',
        '/api/v1/projects/web/schema',
        schema([key('API_URL', { type: 'url', required: true })]),
      )
      .reply(
        'GET',
        '/api/v1/projects/web/envs/local/variables',
        delivered('local', { API_URL: 'https://api' }),
      );
    const test = await createTestContext(api, { cwd: root });
    await signedIn(test.credentials);

    expect(await doctor(test.context)).toBe(0);
    const text = test.logs.info.join('\n');
    expect(text).toMatch(/✓ senv\.json/);
    expect(text).toMatch(/✓ 로그인: alice/);
    expect(text).toMatch(/✓ \.gitignore/);
    expect(text).toMatch(/✓ 키 검사/);
  });

  it('필수 누락·타입 오류·secret 노출은 문제로, 스키마에 없는 공개 키는 경고로 보이고 1을 돌려준다', async () => {
    const root = await webRepo();
    const api = new FakeApi()
      .reply('GET', '/api/v1/me', me)
      .reply(
        'GET',
        '/api/v1/projects/web/schema',
        schema([key('DATABASE_URL', { required: true }), key('PORT', { type: 'number' })]),
      )
      .reply(
        'GET',
        '/api/v1/projects/web/envs/local/variables',
        delivered(
          'local',
          { PORT: 'eighty', VITE_SECRET: 's', VITE_NEW: 'n' },
          {
            exposure: { exposedSecrets: ['VITE_SECRET'], unregistered: ['VITE_NEW'] },
          },
        ),
      );
    const test = await createTestContext(api, { cwd: root });
    await signedIn(test.credentials);

    expect(await doctor(test.context)).toBe(1);
    const text = test.logs.info.join('\n');
    expect(text).toMatch(/✗ DATABASE_URL: 필수/);
    expect(text).toMatch(/✗ PORT: number/);
    expect(text).toMatch(/✗ VITE_SECRET: secret/);
    expect(text).toMatch(/⚠ VITE_NEW/);
  });

  it('senv.json이 없거나 로그인하지 않았으면 거기서 멈추고 1을 돌려준다', async () => {
    const noConfig = await createTestContext(new FakeApi(), { cwd: await makeTempDir() });
    expect(await doctor(noConfig.context)).toBe(1);
    expect(noConfig.logs.info.join('\n')).toMatch(/✗ senv\.json/);

    const root = await webRepo();
    const loggedOut = await createTestContext(new FakeApi(), { cwd: root });
    expect(await doctor(loggedOut.context)).toBe(1);
    expect(loggedOut.logs.info.join('\n')).toMatch(/✗ 로그인.*senv login/);
  });

  it('출력 파일이 git에서 무시되지 않으면 문제다', async () => {
    const root = await webRepo({ project: 'web', output: 'secrets.txt' });
    const api = new FakeApi()
      .reply('GET', '/api/v1/me', me)
      .reply('GET', '/api/v1/projects/web/schema', schema([]))
      .reply('GET', '/api/v1/projects/web/envs/local/variables', delivered('local', {}));
    const test = await createTestContext(api, { cwd: root });
    await signedIn(test.credentials);

    expect(await doctor(test.context)).toBe(1);
    expect(test.logs.info.join('\n')).toMatch(/✗ \.gitignore.*secrets\.txt/);
  });
});
