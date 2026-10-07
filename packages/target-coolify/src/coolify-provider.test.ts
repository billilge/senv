import { TargetNotFoundError, TargetUnavailableError } from '@senv/core';
import { describeProviderContract } from '@senv/target-testkit/contract';
import { describe, expect, it } from 'vitest';
import { createCoolifyProvider } from './index';
import { createFakeCoolify } from './testing/fake-coolify';

const TOKEN = '1|coolify-test-token';

function setup() {
  const coolify = createFakeCoolify({
    token: TOKEN,
    apps: [{ uuid: 'app-uuid-1', name: 'stream-api-prod', fqdn: 'https://api.stream.example' }],
  });
  const provider = createCoolifyProvider({ fetch: coolify.fetch });
  const connection = provider.parseConnection({ url: 'https://coolify.example/', token: TOKEN });
  return { coolify, provider, connection };
}

describeProviderContract('Coolify', () => {
  const { provider } = setup();
  return {
    provider,
    connection: { url: 'https://coolify.example', token: TOKEN },
    resourceId: 'app-uuid-1',
    invalidConnection: { url: 'ftp://coolify', token: '' },
    badCredentials: { url: 'https://coolify.example', token: 'wrong' },
  };
});

const want = (key: string, value: string, buildTime = false) => ({
  key,
  value,
  buildTime,
  multiline: value.includes('\n'),
});

describe('Coolify 제공자', () => {
  it('리소스는 Application이고 주소(fqdn)를 설명으로 쓴다', async () => {
    const { provider, connection, coolify } = setup();
    expect(await provider.listResources(connection)).toEqual([
      { id: 'app-uuid-1', name: 'stream-api-prod', description: 'https://api.stream.example' },
    ]);
    expect(coolify.requests[0]).toMatchObject({ method: 'GET', path: '/applications' });
  });

  it('추가·변경은 bulk로 한 번에 보내고, $를 치환하지 않도록 is_literal을 켠다', async () => {
    const { provider, connection, coolify } = setup();
    await provider.applyPlan(
      connection,
      'app-uuid-1',
      {
        add: [want('VITE_API_URL', 'https://x', true), want('PEM', 'a\nb')],
        change: [],
        remove: [],
        unchanged: [],
      },
      { preview: false },
    );

    const bulk = coolify.requests.find((r) => r.method === 'PATCH');
    expect(bulk).toMatchObject({ path: '/applications/app-uuid-1/envs/bulk' });
    expect(bulk?.body).toEqual({
      data: [
        {
          key: 'VITE_API_URL',
          value: 'https://x',
          is_preview: false,
          is_buildtime: true,
          is_runtime: false,
          is_literal: true,
          is_multiline: false,
        },
        {
          key: 'PEM',
          value: 'a\nb',
          is_preview: false,
          is_buildtime: false,
          is_runtime: true,
          is_literal: true,
          is_multiline: true,
        },
      ],
    });
  });

  it('Preview 배포 반영을 켜면 preview용 변수로도 넣는다. 읽을 때는 preview가 아닌 것만 본다', async () => {
    const { provider, connection, coolify } = setup();
    await provider.applyPlan(
      connection,
      'app-uuid-1',
      { add: [want('A', '1')], change: [], remove: [], unchanged: [] },
      provider.parseMappingOptions({ preview: true }),
    );
    expect(coolify.apps[0]?.envs.map((env) => [env.key, env.is_preview])).toEqual([
      ['A', false],
      ['A', true],
    ]);
    expect(await provider.readVariables(connection, 'app-uuid-1')).toEqual([
      { key: 'A', value: '1', buildTime: false },
    ]);
  });

  it('삭제는 변수 uuid를 찾아 하나씩 지운다 (preview 변수도 함께)', async () => {
    const { provider, connection, coolify } = setup();
    const options = provider.parseMappingOptions({ preview: true });
    await provider.applyPlan(
      connection,
      'app-uuid-1',
      { add: [want('OLD', 'x')], change: [], remove: [], unchanged: [] },
      options,
    );
    await provider.applyPlan(
      connection,
      'app-uuid-1',
      { add: [], change: [], remove: ['OLD'], unchanged: [] },
      options,
    );

    expect(coolify.apps[0]?.envs).toEqual([]);
    expect(coolify.requests.filter((r) => r.method === 'DELETE').map((r) => r.path)).toEqual([
      '/applications/app-uuid-1/envs/env-1',
      '/applications/app-uuid-1/envs/env-2',
    ]);
  });

  it('재시작과 재배포는 Coolify의 deployment_uuid를 참조로 돌려준다', async () => {
    const { provider, connection, coolify } = setup();
    expect(await provider.runAction?.(connection, 'app-uuid-1', 'restart')).toEqual({
      ref: 'dep-restart',
    });
    expect(await provider.runAction?.(connection, 'app-uuid-1', 'redeploy')).toEqual({
      ref: 'dep-deploy',
    });
    expect(coolify.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /applications/app-uuid-1/restart',
      'GET /deploy?uuid=app-uuid-1',
    ]);
  });

  it('없는 Application은 TargetNotFoundError, 5xx는 TargetUnavailableError다', async () => {
    const { provider, connection, coolify } = setup();
    await expect(provider.readVariables(connection, 'missing')).rejects.toThrow(
      TargetNotFoundError,
    );
    coolify.failNext(502);
    await expect(provider.listResources(connection)).rejects.toThrow(TargetUnavailableError);
  });

  it('연결 주소는 끝의 /와 /api/v1을 정리해서 저장한다', () => {
    const { provider } = setup();
    expect(provider.parseConnection({ url: 'http://coolify:8000/api/v1/', token: 't' })).toEqual({
      url: 'http://coolify:8000',
      token: 't',
    });
  });
});
