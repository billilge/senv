import {
  type ApplyResult,
  type FieldSpec,
  InvalidTargetConfigError,
  type RemoteVariable,
  type SyncPlan,
  type TargetAction,
  TargetAuthError,
  TargetNotFoundError,
  type TargetProvider,
  type TargetResource,
  TargetUnavailableError,
} from '@senv/core';

export interface CoolifyConnection {
  /** Coolify 주소 (끝의 / 와 /api/v1 은 뺀다). API는 {url}/api/v1 */
  url: string;
  /** Keys & Tokens > API tokens 에서 발급한 토큰 */
  token: string;
}

export interface CoolifyOptions {
  /** Preview 배포용 변수로도 넣는다 */
  preview: boolean;
}

/** Coolify API의 환경변수 객체 중 쓰는 필드 (PRD 8.5, 결정 51) */
interface CoolifyEnv {
  uuid: string;
  key: string;
  value: string | null;
  is_preview: boolean;
  is_buildtime?: boolean;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const CONNECTION_FIELDS: FieldSpec[] = [
  {
    name: 'url',
    label: 'Coolify 주소',
    kind: 'url',
    required: true,
    description: '예: https://coolify.example.com. 같은 서버면 내부 주소를 쓴다',
  },
  {
    name: 'token',
    label: 'API 토큰',
    kind: 'secret',
    required: true,
    description: 'Coolify의 Keys & Tokens > API tokens에서 발급한다',
  },
];

const OPTION_FIELDS: FieldSpec[] = [
  { name: 'preview', label: 'Preview 배포에도 넣기', kind: 'boolean' },
];

/**
 * Coolify 제공자 (PRD 8.5). Application을 리소스로 보고 환경변수 API로 값을 쓴다.
 * 모든 변수는 is_literal을 켜서 Coolify가 값의 $를 치환하지 않게 한다.
 */
export function createCoolifyProvider(
  deps: { fetch?: Fetch } = {},
): TargetProvider<CoolifyConnection, CoolifyOptions> {
  const fetchFn: Fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function call<T>(
    connection: CoolifyConnection,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetchFn(`${connection.url}/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${connection.token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new TargetUnavailableError(`Coolify에 연결할 수 없습니다: ${(error as Error).message}`);
    }
    if (response.ok) return (await response.json()) as T;

    const message = await response
      .json()
      .then((data) => (data as { message?: string }).message ?? '')
      .catch(() => '');
    if (response.status === 401 || response.status === 403) {
      throw new TargetAuthError('Coolify가 API 토큰을 거부했습니다');
    }
    if (response.status === 404) throw new TargetNotFoundError(`Coolify에 없습니다: ${path}`);
    if (response.status >= 500) {
      throw new TargetUnavailableError(`Coolify 오류 (${response.status}) ${message}`.trim());
    }
    throw new Error(`Coolify 요청 실패 (${response.status}) ${message}`.trim());
  }

  const envsOf = (connection: CoolifyConnection, uuid: string) =>
    call<CoolifyEnv[]>(connection, 'GET', `/applications/${encodeURIComponent(uuid)}/envs`);

  return {
    type: 'coolify',
    displayName: 'Coolify',
    capabilities: {
      readValues: true,
      deleteKeys: true,
      actions: ['restart', 'redeploy'],
      buildTimeFlag: true,
    },
    connectionFields: CONNECTION_FIELDS,
    mappingOptionFields: OPTION_FIELDS,

    parseConnection(input) {
      const { url, token } = (input ?? {}) as { url?: unknown; token?: unknown };
      if (typeof url !== 'string' || !/^https?:\/\//.test(url) || !URL.canParse(url)) {
        throw new InvalidTargetConfigError('Coolify 주소는 http(s) 주소여야 합니다');
      }
      if (typeof token !== 'string' || token.trim() === '') {
        throw new InvalidTargetConfigError('API 토큰이 필요합니다');
      }
      return { url: url.replace(/\/+$/, '').replace(/\/api\/v1$/, ''), token: token.trim() };
    },

    parseMappingOptions(input) {
      const preview = (input ?? {}) as { preview?: unknown };
      return { preview: preview.preview === true };
    },

    async testConnection(connection) {
      await call(connection, 'GET', '/applications');
    },

    async listResources(connection): Promise<TargetResource[]> {
      const apps = await call<{ uuid: string; name: string; fqdn?: string | null }[]>(
        connection,
        'GET',
        '/applications',
      );
      return apps.map((app) => ({
        id: app.uuid,
        name: app.name,
        ...(app.fqdn ? { description: app.fqdn } : {}),
      }));
    },

    async readVariables(connection, resourceId): Promise<RemoteVariable[]> {
      const envs = await envsOf(connection, resourceId);
      return envs
        .filter((env) => !env.is_preview)
        .map((env) => ({
          key: env.key,
          value: env.value ?? '',
          buildTime: env.is_buildtime === true,
        }));
    },

    async applyPlan(connection, resourceId, plan: SyncPlan, options): Promise<ApplyResult> {
      const app = `/applications/${encodeURIComponent(resourceId)}`;
      const upserts = [...plan.add, ...plan.change].flatMap((variable) =>
        (options.preview ? [false, true] : [false]).map((isPreview) => ({
          key: variable.key,
          value: variable.value,
          is_preview: isPreview,
          is_buildtime: variable.buildTime,
          is_runtime: !variable.buildTime,
          is_literal: true,
          is_multiline: variable.multiline,
        })),
      );
      if (upserts.length > 0)
        await call(connection, 'PATCH', `${app}/envs/bulk`, { data: upserts });

      if (plan.remove.length > 0) {
        const removing = new Set(plan.remove);
        const envs = await envsOf(connection, resourceId);
        for (const env of envs) {
          if (!removing.has(env.key) || (env.is_preview && !options.preview)) continue;
          await call(connection, 'DELETE', `${app}/envs/${encodeURIComponent(env.uuid)}`);
        }
      }
      return {};
    },

    async runAction(connection, resourceId, action: TargetAction): Promise<ApplyResult> {
      const uuid = encodeURIComponent(resourceId);
      if (action === 'restart') {
        const result = await call<{ deployment_uuid?: string }>(
          connection,
          'POST',
          `/applications/${uuid}/restart`,
        );
        return result.deployment_uuid ? { ref: result.deployment_uuid } : {};
      }
      const result = await call<{ deployments?: { deployment_uuid?: string }[] }>(
        connection,
        'GET',
        `/deploy?uuid=${uuid}`,
      );
      const ref = result.deployments?.[0]?.deployment_uuid;
      return ref ? { ref } : {};
    },
  };
}
