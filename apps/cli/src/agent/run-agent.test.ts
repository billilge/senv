import { SenvApiError } from '@senv/api-client';
import { describe, expect, it } from 'vitest';
import { createTestContext, FakeApi, signedIn } from '../testing/fake-api.js';
import { runAgent } from './agent.js';

const device = {
  status: 201,
  body: { id: 'd1', name: 'test-host', createdAt: '2026-10-09T09:00:00.000Z', lastSeenAt: null },
};

describe('senv agent (반복)', () => {
  it('주기마다 연결을 확인하고 그 사이에 interval초를 기다린다', async () => {
    const api = new FakeApi()
      .reply('POST', '/api/v1/agent/devices', device)
      .reply('GET', '/api/v1/agent/devices/d1/links', { status: 200, body: { links: [] } });
    const { credentials, context, sleeps } = await createTestContext(api);
    await signedIn(credentials);

    await runAgent(context, { interval: 30, cycles: 3 });

    expect(api.requests.filter((r) => r.path.endsWith('/links'))).toHaveLength(3);
    expect(sleeps).toEqual([30_000, 30_000]);
  });

  it('서버 오류나 네트워크 오류는 알리고 다음 주기에 다시 시도한다', async () => {
    const api = new FakeApi()
      .reply('POST', '/api/v1/agent/devices', device)
      .reply(
        'GET',
        '/api/v1/agent/devices/d1/links',
        { status: 503, body: { code: 'unavailable', message: '잠시 뒤에' } },
        { status: 200, body: { links: [] } },
      );
    const { credentials, context, logs } = await createTestContext(api);
    await signedIn(credentials);

    await runAgent(context, { interval: 30, cycles: 2 });

    expect(logs.warn.join('\n')).toContain('잠시 뒤에');
    expect(api.requests.filter((r) => r.path.endsWith('/links'))).toHaveLength(2);
  });

  it('로그인이 끊기면(401) 멈추고 오류를 낸다', async () => {
    const api = new FakeApi()
      .reply('POST', '/api/v1/agent/devices', device)
      .reply('GET', '/api/v1/agent/devices/d1/links', {
        status: 401,
        body: { code: 'unauthorized', message: '로그인이 필요합니다' },
      });
    const { credentials, context, sleeps } = await createTestContext(api);
    await signedIn(credentials);

    await expect(runAgent(context, { interval: 30, cycles: 5 })).rejects.toBeInstanceOf(
      SenvApiError,
    );
    expect(sleeps).toEqual([]);
  });
});
