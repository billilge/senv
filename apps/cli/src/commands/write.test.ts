// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 쓴다
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Prompt } from '../context.js';
import { createTestContext, FakeApi, signedIn } from '../testing/fake-api.js';
import { delivered, raw, webRepo } from '../testing/repo.js';
import {
  CancelledError,
  ConfirmationMismatchError,
  InvalidAssignmentError,
  push,
  set,
} from './write.js';

const published = (version = 4) => ({
  status: 201,
  body: { version, diff: { added: [], removed: [], changed: [], unchanged: [] } },
});

async function setup(api: FakeApi, root: string, answers: Partial<Prompt> = {}) {
  const test = await createTestContext(api, { cwd: root });
  await signedIn(test.credentials);
  test.context.prompt = {
    ...test.context.prompt,
    confirm: async () => true,
    text: async () => '',
    ...answers,
  };
  return test;
}

const postBody = (api: FakeApi) => api.requests.find((r) => r.method === 'POST')?.body;

describe('senv set', () => {
  it('KEY=VALUE를 기준 버전과 함께 게시한다 (바뀐 키만 보내고 확인을 받는다)', async () => {
    const root = await webRepo();
    const api = new FakeApi()
      .reply('GET', '/api/v1/projects/web/envs/local', raw('local', { A: '1', B: 'same' }))
      .reply('POST', '/api/v1/projects/web/envs/local/versions', published(4));
    const asked: string[] = [];
    const { context, logs } = await setup(api, root, {
      confirm: async (message) => {
        asked.push(message);
        return true;
      },
    });

    await set(context, ['A=2', 'B=same', 'URL=https://x?a=b'], { message: 'CLI에서' });

    expect(postBody(api)).toEqual({
      baseVersion: 3,
      changes: { set: { A: '2', URL: 'https://x?a=b' } },
      message: 'CLI에서',
    });
    expect(asked).toHaveLength(1);
    expect(logs.info.join('\n')).toMatch(
      /변경: A[\s\S]*추가: URL[\s\S]*게시했습니다: web\/local v4/,
    );
  });

  it('--yes면 묻지 않는다. 바뀐 것이 없으면 게시하지 않는다', async () => {
    const root = await webRepo();
    const api = new FakeApi().reply(
      'GET',
      '/api/v1/projects/web/envs/local',
      raw('local', { A: '1' }),
    );
    const { context, logs } = await setup(api, root, {
      confirm: async () => {
        throw new Error('묻지 않아야 한다');
      },
    });

    await set(context, ['A=1'], { yes: true });
    expect(postBody(api)).toBeUndefined();
    expect(logs.info.join('\n')).toMatch(/바뀐 값이 없습니다/);
  });

  it('확인에서 아니라고 하면 CancelledError다', async () => {
    const root = await webRepo();
    const api = new FakeApi().reply('GET', '/api/v1/projects/web/envs/local', raw('local', {}));
    const { context } = await setup(api, root, { confirm: async () => false });
    await expect(set(context, ['A=1'])).rejects.toThrow(CancelledError);
    expect(postBody(api)).toBeUndefined();
  });

  it('production은 --yes여도 프로젝트 이름을 다시 입력해야 한다', async () => {
    const root = await webRepo();
    const api = new FakeApi()
      .reply('GET', '/api/v1/projects/web/envs/production', raw('production', {}))
      .reply('POST', '/api/v1/projects/web/envs/production/versions', published(1));

    const wrong = await setup(api, root, { text: async () => 'wbe' });
    await expect(set(wrong.context, ['A=1'], { env: 'production', yes: true })).rejects.toThrow(
      ConfirmationMismatchError,
    );

    const right = await setup(api, root, { text: async () => 'web' });
    await set(right.context, ['A=1'], { env: 'production', yes: true });
    expect(postBody(api)).toMatchObject({ changes: { set: { A: '1' } } });
  });

  it('KEY=VALUE 형식이 아니면 InvalidAssignmentError다', async () => {
    const root = await webRepo();
    const { context } = await setup(new FakeApi(), root);
    await expect(set(context, ['NOVALUE'])).rejects.toThrow(InvalidAssignmentError);
  });
});

describe('senv push', () => {
  it('로컬 파일에서 서버(공유 참조를 푼 값)와 달라진 키만 보낸다. 참조는 덮어쓰지 않는다', async () => {
    const root = await webRepo();
    await writeFile(join(root, '.env.local'), 'API_URL=https://api.stream.dev\nMODE=dev2\nNEW=1\n');
    const api = new FakeApi()
      .reply(
        'GET',
        '/api/v1/projects/web/envs/local/variables',
        delivered('local', { API_URL: 'https://api.stream.dev', MODE: 'dev', GONE: 'x' }),
      )
      .reply('POST', '/api/v1/projects/web/envs/local/versions', published(4));
    const { context, logs } = await setup(api, root);

    await push(context, { yes: true });

    expect(postBody(api)).toEqual({ baseVersion: 3, changes: { set: { MODE: 'dev2', NEW: '1' } } });
    expect(logs.info.join('\n')).toMatch(/GONE.*--prune/);
  });

  it('--prune이면 파일에 없는 키도 지운다', async () => {
    const root = await webRepo();
    await writeFile(join(root, 'prod.env'), 'A=1\n');
    const api = new FakeApi()
      .reply(
        'GET',
        '/api/v1/projects/web/envs/local/variables',
        delivered('local', { A: '1', GONE: 'x' }),
      )
      .reply('POST', '/api/v1/projects/web/envs/local/versions', published(4));
    const { context } = await setup(api, root);

    await push(context, { file: 'prod.env', prune: true, yes: true });
    expect(postBody(api)).toEqual({ baseVersion: 3, changes: { remove: ['GONE'] } });
  });
});

describe('senv push (properties 형식)', () => {
  it('properties 규칙으로 읽어 달라진 키만 보낸다', async () => {
    const root = await webRepo({ project: 'web', format: 'properties' });
    await writeFile(join(root, '.env.local.properties'), 'A=a\\=b\nGREETING=\\uC548\\uB155\n');
    const api = new FakeApi()
      .reply(
        'GET',
        '/api/v1/projects/web/envs/local/variables',
        delivered('local', { A: 'a=b', GREETING: 'hi' }),
      )
      .reply('POST', '/api/v1/projects/web/envs/local/versions', published(4));
    const { context } = await setup(api, root);

    await push(context, { yes: true });
    expect(postBody(api)).toEqual({ baseVersion: 3, changes: { set: { GREETING: '안녕' } } });
  });
});
