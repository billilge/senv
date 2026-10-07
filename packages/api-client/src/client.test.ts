import { describe, expect, it } from 'vitest';
import { createSenvClient, SenvApiError, SenvNetworkError, unwrap } from './index';

function fakeServer(status: number, body: unknown, contentType = 'application/json') {
  const requests: Request[] = [];
  const fetch = async (request: Request) => {
    requests.push(request);
    const payload = status === 204 ? null : typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(payload, {
      status,
      headers: status === 204 ? {} : { 'Content-Type': contentType },
    });
  };
  return { requests, fetch };
}

const delivered = {
  project: 'web',
  env: 'local',
  version: 3,
  sharedVersion: 1,
  variables: { VITE_MODE: 'dev' },
};

describe('createSenvClient', () => {
  it('access 토큰을 요청마다 받아 Authorization: Bearer 헤더로 붙인다', async () => {
    const server = fakeServer(200, delivered);
    let token = 'senv_at_first';
    const client = createSenvClient({
      baseUrl: 'https://senv.example.com',
      accessToken: () => token,
      fetch: server.fetch,
    });

    await client.GET('/api/v1/me');
    token = 'senv_at_second';
    await client.GET('/api/v1/me');

    expect(server.requests.map((r) => r.headers.get('Authorization'))).toEqual([
      'Bearer senv_at_first',
      'Bearer senv_at_second',
    ]);
  });

  it('토큰이 없으면 Authorization 헤더를 붙이지 않는다', async () => {
    const server = fakeServer(200, {});
    const client = createSenvClient({ baseUrl: 'https://senv.example.com', fetch: server.fetch });
    await client.POST('/api/v1/auth/device');
    expect(server.requests[0]?.headers.has('Authorization')).toBe(false);
  });

  it('baseUrl 끝의 / 를 정리하고 경로 값을 URL에 넣는다', async () => {
    const server = fakeServer(200, delivered);
    const client = createSenvClient({ baseUrl: 'https://senv.example.com/', fetch: server.fetch });
    await client.GET('/api/v1/projects/{project}/envs/{env}/variables', {
      params: { path: { project: 'web', env: 'local' } },
    });
    expect(server.requests[0]?.url).toBe(
      'https://senv.example.com/api/v1/projects/web/envs/local/variables',
    );
  });
});

describe('unwrap', () => {
  const call = (server: ReturnType<typeof fakeServer>) =>
    createSenvClient({ baseUrl: 'https://senv.example.com', fetch: server.fetch }).GET(
      '/api/v1/projects/{project}/envs/{env}/variables',
      { params: { path: { project: 'web', env: 'local' } } },
    );

  it('성공 응답이면 data를 돌려준다', async () => {
    expect(await unwrap(call(fakeServer(200, delivered)))).toEqual(delivered);
  });

  it('오류 응답이면 상태·code·메시지·details를 담은 SenvApiError를 던진다', async () => {
    const server = fakeServer(409, {
      code: 'broken_reference',
      message: '해석할 수 없는 공유 참조가 있습니다',
      details: { issues: [{ key: 'A' }] },
    });
    const error = await unwrap(call(server)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SenvApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'broken_reference',
      message: '해석할 수 없는 공유 참조가 있습니다',
      details: { issues: [{ key: 'A' }] },
    });
  });

  it('JSON이 아닌 오류 응답(프록시의 502 등)이면 code가 http_error다', async () => {
    const error = await unwrap(
      call(fakeServer(502, '<html>Bad Gateway</html>', 'text/html')),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: 'http_error' });
  });

  it('네트워크 오류면 SenvNetworkError를 던진다', async () => {
    const client = createSenvClient({
      baseUrl: 'https://senv.example.com',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(unwrap(client.GET('/api/v1/me'))).rejects.toThrow(SenvNetworkError);
  });

  it('네트워크 오류가 아닌 오류(예: 토큰 준비 실패)는 감싸지 않고 그대로 던진다', async () => {
    class NotLoggedIn extends Error {}
    const client = createSenvClient({
      baseUrl: 'https://senv.example.com',
      accessToken: () => {
        throw new NotLoggedIn('로그인하세요');
      },
      fetch: fakeServer(200, {}).fetch,
    });
    await expect(unwrap(client.GET('/api/v1/me'))).rejects.toThrow(NotLoggedIn);
  });

  it('204 응답이면 undefined를 돌려준다', async () => {
    const client = createSenvClient({
      baseUrl: 'https://senv.example.com',
      fetch: fakeServer(204, null).fetch,
    });
    await expect(
      unwrap(client.POST('/api/v1/auth/token/revoke', { body: { token: 'senv_at_x' } })),
    ).resolves.toBeUndefined();
  });
});
