import { join } from 'node:path';
import { createSenvClient } from '@senv/api-client';
import { FileCredentialStore } from '../auth/credentials.js';
import { CliSession } from '../auth/session.js';
import type { CliContext } from '../context.js';
import { makeTempDir } from './temp-dir.js';

type Handler = (request: Request, body: unknown) => { status: number; body?: unknown };

/** 경로별로 응답을 정해 두는 가짜 서버. 실제 api-client에 fetch로 끼운다 */
export class FakeApi {
  readonly requests: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  private readonly routes = new Map<string, Handler[]>();

  /** 같은 경로를 여러 번 등록하면 차례로 쓰고, 마지막 것은 계속 쓴다 */
  on(method: string, path: string, ...handlers: Handler[]): this {
    this.routes.set(`${method} ${path}`, handlers);
    return this;
  }

  reply(method: string, path: string, ...responses: { status: number; body?: unknown }[]): this {
    return this.on(method, path, ...responses.map((response) => () => response));
  }

  readonly fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const text = await request.text();
    const body = text ? JSON.parse(text) : undefined;
    this.requests.push({
      method: request.method,
      path: url.pathname,
      body,
      auth: request.headers.get('Authorization'),
    });
    const handlers = this.routes.get(`${request.method} ${url.pathname}`);
    const handler = handlers && (handlers.length > 1 ? handlers.shift() : handlers[0]);
    const response = handler
      ? handler(request, body)
      : {
          status: 404,
          body: { code: 'not_found', message: `가짜 서버에 없는 경로: ${url.pathname}` },
        };
    return new Response(response.status === 204 ? null : JSON.stringify(response.body ?? {}), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

export const TEST_API_URL = 'https://senv.example.com';

/** 가짜 서버와 임시 폴더로 CLI 컨텍스트를 만든다. 출력과 대기·브라우저 호출을 기록한다 */
export async function createTestContext(
  api: FakeApi,
  overrides: Partial<Pick<CliContext, 'cwd' | 'env' | 'now'>> = {},
) {
  const configDir = await makeTempDir();
  const credentials = new FileCredentialStore(configDir);
  const logs = { info: [] as string[], warn: [] as string[], result: [] as string[] };
  const sleeps: number[] = [];
  const opened: string[] = [];
  const now = overrides.now ?? (() => new Date('2026-10-07T09:00:00.000Z'));

  const anonymousApi = createSenvClient({ baseUrl: TEST_API_URL, fetch: api.fetch });
  const session = new CliSession({
    apiUrl: TEST_API_URL,
    store: credentials,
    lockPath: join(configDir, 'refresh.lock'),
    now,
    refresh: async () => {
      throw new Error('테스트에서는 refresh를 쓰지 않는다');
    },
  });

  const context: CliContext = {
    cwd: overrides.cwd ?? (await makeTempDir()),
    env: overrides.env ?? {},
    apiUrl: TEST_API_URL,
    out: {
      info: (message) => logs.info.push(message),
      warn: (message) => logs.warn.push(message),
      result: (text) => logs.result.push(text),
    },
    api: createSenvClient({
      baseUrl: TEST_API_URL,
      fetch: api.fetch,
      accessToken: () => session.accessToken(),
    }),
    anonymousApi,
    credentials,
    prompt: {
      select: async () => {
        throw new Error('테스트에서 정한 답이 없습니다');
      },
      confirm: async () => {
        throw new Error('테스트에서 정한 답이 없습니다');
      },
      text: async () => {
        throw new Error('테스트에서 정한 답이 없습니다');
      },
    },
    openBrowser: async (url) => {
      opened.push(url);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now,
  };
  return { context, logs, sleeps, opened, credentials };
}

/** 이미 로그인한 상태로 만든다 (access 토큰 1시간 유효) */
export async function signedIn(credentials: FileCredentialStore, token = 'senv_at_test') {
  await credentials.save({
    apiUrl: TEST_API_URL,
    accessToken: token,
    accessExpiresAt: '2026-10-07T10:00:00.000Z',
    refreshToken: 'senv_rt_test',
    refreshExpiresAt: '2026-11-06T09:00:00.000Z',
  });
}
