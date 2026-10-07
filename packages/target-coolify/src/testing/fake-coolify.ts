/**
 * Coolify API v4를 흉내 내는 가짜 서버 (실제 Coolify에 붙지 않는다, 결정 46).
 * 응답 모양은 Coolify API 문서의 Application·EnvironmentVariable 객체를 따른다.
 */
export interface FakeEnv {
  uuid: string;
  key: string;
  value: string;
  is_preview: boolean;
  is_buildtime: boolean;
  is_runtime: boolean;
  is_literal: boolean;
  is_multiline: boolean;
}

export interface FakeApp {
  uuid: string;
  name: string;
  fqdn: string | null;
  envs: FakeEnv[];
}

export function createFakeCoolify(options: { token: string; apps: Omit<FakeApp, 'envs'>[] }) {
  const apps: FakeApp[] = options.apps.map((app) => ({ ...app, envs: [] }));
  const requests: { method: string; path: string; body: unknown }[] = [];
  let sequence = 0;
  let failure: number | null = null;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const body = text ? JSON.parse(text) : undefined;
    const path = url.pathname.replace(/^\/api\/v1/, '');
    requests.push({ method: request.method, path: `${path}${url.search}`, body });

    if (failure !== null) {
      const status = failure;
      failure = null;
      return json(status, { message: 'Server error' });
    }
    if (request.headers.get('Authorization') !== `Bearer ${options.token}`) {
      return json(401, { message: 'Unauthenticated.' });
    }
    if (request.method === 'GET' && path === '/applications') {
      return json(
        200,
        apps.map(({ envs: _envs, ...app }) => ({ ...app, description: null })),
      );
    }
    if (request.method === 'GET' && path === '/deploy') {
      const app = apps.find((candidate) => candidate.uuid === url.searchParams.get('uuid'));
      if (!app) return json(404, { message: 'Resource not found.' });
      return json(200, {
        deployments: [
          {
            message: 'Application deployment queued.',
            resource_uuid: app.uuid,
            deployment_uuid: 'dep-deploy',
          },
        ],
      });
    }
    const match = path.match(/^\/applications\/([^/]+)(\/.*)?$/);
    const app = match && apps.find((candidate) => candidate.uuid === match[1]);
    if (!match || !app) return json(404, { message: 'Resource not found.' });
    const rest = match[2] ?? '';

    if (request.method === 'GET' && rest === '/envs') return json(200, app.envs);
    if (request.method === 'PATCH' && rest === '/envs/bulk') {
      for (const item of (body as { data: Partial<FakeEnv>[] }).data) {
        const existing = app.envs.find(
          (env) => env.key === item.key && env.is_preview === (item.is_preview ?? false),
        );
        const fields = {
          value: String(item.value),
          is_preview: item.is_preview ?? false,
          is_buildtime: item.is_buildtime ?? false,
          is_runtime: item.is_runtime ?? true,
          is_literal: item.is_literal ?? false,
          is_multiline: item.is_multiline ?? false,
        };
        if (existing) Object.assign(existing, fields);
        else app.envs.push({ uuid: `env-${++sequence}`, key: String(item.key), ...fields });
      }
      return json(201, app.envs);
    }
    const env = rest.match(/^\/envs\/([^/]+)$/);
    if (request.method === 'DELETE' && env) {
      const index = app.envs.findIndex((candidate) => candidate.uuid === env[1]);
      if (index < 0) return json(404, { message: 'Environment variable not found.' });
      app.envs.splice(index, 1);
      return json(200, { message: 'Environment variable deleted.' });
    }
    if (request.method === 'POST' && rest === '/restart') {
      return json(200, { message: 'Restart request queued.', deployment_uuid: 'dep-restart' });
    }
    return json(404, { message: 'Not found.' });
  };

  return {
    fetch,
    apps,
    requests,
    /** 다음 요청을 이 상태 코드로 실패시킨다 */
    failNext(status: number) {
      failure = status;
    },
  };
}
