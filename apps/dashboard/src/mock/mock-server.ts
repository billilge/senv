// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 쓴다
import type { ApiSchemas } from '@senv/api-client';
import {
  applyChangeSet,
  type ChangeSet,
  createChangeSet,
  diffVariables,
  ENVIRONMENT_NAMES,
  type EnvironmentName,
  hasChanges,
  isEnvironmentName,
  isValidKeyName,
  isValidProjectName,
  isValidPublicPrefix,
  matchesKeyFilter,
  resolveSharedReferences,
  SHARED_PROJECT_NAME,
  validateEnvironment,
  versionRo,
} from '@senv/core';
import {
  connectionView,
  initialTargets,
  MOCK_PROVIDER,
  MOCK_RESOURCES,
  type MockConnection,
  type MockMapping,
  type MockRun,
  type MockTargetsState,
  mappingView,
  planFor,
} from './mock-targets';

/**
 * 디자인 확인용 목업 서버 (`pnpm dev:mock`). 서버·DB·GitHub 없이 브라우저 안에서 API를 흉내 낸다.
 * 프로덕션 빌드에는 들어가지 않는다 (main.tsx에서 mock 모드일 때만 불러온다).
 */

type User = ApiSchemas['User'];
type Project = ApiSchemas['Project'];
type KeySchema = ApiSchemas['KeySchema'];

interface ProjectSchema {
  publicPrefixes: string[];
  keys: KeySchema[];
}

export type MockPersona = 'admin' | 'member' | 'pending' | 'signed-out';
type SignedInPersona = Exclude<MockPersona, 'signed-out'>;

interface VersionRecord {
  version: number;
  variables: Record<string, string>;
  message: string;
  createdBy: string;
  createdAt: string;
}

interface Snapshot {
  version: number;
  variables: Record<string, string>;
  /** 버전 기록. 예전에 저장한 목업 데이터에는 없을 수 있다 */
  history?: VersionRecord[];
}

export interface MockState {
  persona: MockPersona;
  /** 로그아웃했다가 다시 로그인할 때 돌아갈 역할 */
  lastPersona: SignedInPersona;
  users: User[];
  projects: Project[];
  values: Record<string, Record<EnvironmentName, Snapshot>>;
  /** 키 스키마. 예전에 저장한 목업 데이터에는 없을 수 있다 */
  schemas?: Record<string, ProjectSchema>;
  /** 역할 미리 지정 (결정 45) */
  assignments?: { login: string; role: 'admin' | 'member'; createdAt: string }[];
  /** 배포 대상 (결정 56). 예전에 저장한 목업 데이터에는 없을 수 있다 */
  targets?: MockTargetsState;
}

const schemaKey = (key: string, fields: Partial<KeySchema> = {}): KeySchema => ({
  key,
  type: 'string',
  visibility: 'secret',
  required: false,
  optionalIn: [],
  buildTime: false,
  description: '',
  ...fields,
});

const PERSONA_USER: Record<SignedInPersona, string> = {
  admin: 'u-alice',
  member: 'u-carol',
  pending: 'u-bob',
};

const user = (id: string, login: string, name: string | null, rest: Partial<User> = {}): User => ({
  id,
  githubId: id,
  login,
  name,
  avatarUrl: null,
  role: 'member',
  status: 'active',
  ...rest,
});

const project = (name: string, displayName: string, kind: Project['kind'] = 'app'): Project => ({
  name,
  displayName,
  kind,
  environments: [...ENVIRONMENT_NAMES],
});

const snap = (version: number, variables: Record<string, string> = {}): Snapshot => ({
  version,
  variables,
  history: Array.from({ length: version }, (_, index) => record(index + 1, version, variables)),
});

const AUTHORS = ['u-alice', 'u-carol', 'u-alice', 'u-dave'];
const MESSAGES = ['초기 값', '키 추가', '값 정리', '주소 변경', '설정 보강'];

/** 예시 기록: 앞 버전일수록 키가 적다. 마지막 버전은 지금 값과 같다 */
function record(version: number, last: number, variables: Record<string, string>): VersionRecord {
  const keys = Object.keys(variables).sort();
  const count = Math.ceil((keys.length * version) / last);
  return {
    version,
    variables: Object.fromEntries(keys.slice(0, count).map((key) => [key, variables[key] ?? ''])),
    message: MESSAGES[(version - 1) % MESSAGES.length] ?? '',
    createdBy: AUTHORS[(version - 1) % AUTHORS.length] ?? 'u-alice',
    createdAt: new Date(Date.UTC(2026, 9, 1 + version, 9 + version)).toISOString(),
  };
}

/** 기록이 없는 예전 목업 데이터는 지금 값 하나만 기록으로 본다 */
function historyOf(snapshot: Snapshot): VersionRecord[] {
  if (snapshot.history) return snapshot.history;
  if (snapshot.version === 0) return [];
  return [{ ...record(snapshot.version, snapshot.version, snapshot.variables), message: '' }];
}

export function initialMockState(): MockState {
  return {
    persona: 'admin',
    lastPersona: 'admin',
    users: [
      user('u-alice', 'alice', 'Alice Kim', { role: 'admin' }),
      user('u-bob', 'bob', 'Bob Lee', { status: 'pending' }),
      user('u-carol', 'carol', null),
      user('u-dave', 'dave', 'Dave Park', { status: 'disabled' }),
    ],
    projects: [
      project('app', '모바일 앱'),
      project(SHARED_PROJECT_NAME, '공유 그룹', 'shared'),
      project('server', 'Stream API'),
      project('web', 'Stream 웹'),
    ],
    schemas: {
      server: {
        publicPrefixes: [],
        keys: [
          schemaKey('API_PORT', { type: 'number', required: true, description: 'HTTP 포트' }),
          schemaKey('DATABASE_URL', {
            type: 'url',
            required: true,
            description: 'MySQL 접속 주소',
          }),
          schemaKey('LOG_LEVEL', { description: 'debug, info, warn, error' }),
          schemaKey('REDIS_URL', { type: 'url', required: true, optionalIn: ['production'] }),
        ],
      },
      web: {
        publicPrefixes: ['VITE_'],
        keys: [
          schemaKey('VITE_API_URL', {
            type: 'url',
            visibility: 'public',
            required: true,
            buildTime: true,
            description: 'API 주소',
          }),
        ],
      },
      app: { publicPrefixes: ['EXPO_PUBLIC_'], keys: [] },
    },
    values: {
      shared: {
        local: snap(1, {
          API_URL: 'http://localhost:8080',
          SENTRY_DSN: 'https://dev@sentry.example/1',
        }),
        development: snap(2, {
          API_URL: 'https://api.dev.stream.example',
          SENTRY_DSN: 'https://dev@sentry.example/1',
        }),
        production: snap(1, {
          API_URL: 'https://api.stream.example',
          SENTRY_DSN: 'https://prod@sentry.example/2',
        }),
      },
      server: {
        local: snap(3, {
          API_PORT: '8080',
          DATABASE_URL: 'mysql://stream:local-pw@localhost:3306/stream',
          JWT_SECRET: 'local-jwt-secret',
          LOG_LEVEL: 'debug',
          REDIS_URL: 'redis://localhost:6379',
          SENTRY_DSN: '${shared.SENTRY_DSN}',
        }),
        development: snap(5, {
          API_PORT: '8080',
          DATABASE_URL: 'mysql://stream:dev-pw@mysql:3306/stream',
          JWT_SECRET: 'dev-jwt-secret',
          LOG_LEVEL: 'info',
          REDIS_URL: 'redis://redis:6379',
          SENTRY_DSN: '${shared.SENTRY_DSN}',
        }),
        production: snap(2, {
          API_PORT: '8080',
          DATABASE_URL: 'mysql://stream:prod-pw@mysql:3306/stream',
          JWT_SECRET: 'prod-jwt-secret',
          LOG_LEVEL: 'info',
          SENTRY_DSN: '${shared.SENTRY_DSN}',
        }),
      },
      web: {
        local: snap(2, { VITE_API_URL: '${shared.API_URL}', VITE_ENABLE_DEVTOOLS: 'true' }),
        development: snap(1, { VITE_API_URL: '${shared.API_URL}', VITE_ENABLE_DEVTOOLS: 'true' }),
        production: snap(0),
      },
      app: { local: snap(0), development: snap(0), production: snap(0) },
    },
  };
}

class Reply {
  constructor(
    readonly status: number,
    readonly body?: unknown,
  ) {}
}

const problem = (status: number, code: string, message: string, details?: object) =>
  new Reply(status, { code, message, ...(details ? { details } : {}) });

export class MockServer {
  constructor(
    private state: MockState,
    private readonly save: (state: MockState) => void = () => {},
    /** 로딩 화면도 보이도록 응답을 이만큼 늦춘다 */
    private readonly delayMs = 0,
  ) {
    if (state.persona !== 'signed-out') this.state = { ...state, lastPersona: state.persona };
  }

  get persona(): MockPersona {
    return this.state.persona;
  }

  setPersona(persona: MockPersona) {
    this.update((state) => {
      state.persona = persona;
      if (persona !== 'signed-out') state.lastPersona = persona;
    });
  }

  /** GitHub 로그인 대신: 마지막으로 고른 역할로 로그인한다 */
  signIn() {
    this.setPersona(this.state.lastPersona);
  }

  reset() {
    this.state = initialMockState();
    this.save(this.state);
  }

  readonly fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const text = await request.text();
    const body = text ? JSON.parse(text) : {};
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));

    const reply = this.route(request.method, url.pathname, body, url.searchParams);
    return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  private update(change: (state: MockState) => void) {
    const next = structuredClone(this.state);
    change(next);
    this.state = next;
    this.save(next);
  }

  private me(): User | undefined {
    if (this.state.persona === 'signed-out') return undefined;
    const id = PERSONA_USER[this.state.persona];
    return this.state.users.find((candidate) => candidate.id === id);
  }

  private route(
    method: string,
    path: string,
    body: Record<string, unknown>,
    query: URLSearchParams = new URLSearchParams(),
  ): Reply {
    const me = this.me();
    if (path === '/api/v1/me' && method === 'GET') {
      return me ? new Reply(200, me) : problem(401, 'unauthorized', '로그인이 필요합니다');
    }
    if (!me) return problem(401, 'unauthorized', '로그인이 필요합니다');
    if (path === '/api/v1/auth/logout' && method === 'POST') {
      this.setPersona('signed-out');
      return new Reply(204);
    }
    if (me.status !== 'active') {
      return problem(403, 'user_not_active', '관리자 승인을 기다리는 중입니다');
    }

    if (path === '/api/v1/auth/device/approve' && method === 'POST') {
      const code = String(body.userCode ?? '')
        .toUpperCase()
        .replace('-', '');
      return /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/.test(code)
        ? new Reply(204)
        : problem(
            404,
            'device_code_not_found',
            '코드를 찾을 수 없습니다. CLI에 표시된 코드를 다시 확인하세요',
          );
    }

    if (path === '/api/v1/projects') {
      if (method === 'GET') {
        // 서버처럼 공유 그룹은 목록에 넣지 않는다 (대시보드가 따로 맨 위에 보여준다)
        const apps = this.state.projects.filter((candidate) => candidate.kind === 'app');
        if (query.get('include') !== 'summary') return new Reply(200, { projects: apps });
        return new Reply(200, {
          projects: apps.map((app) => ({ ...app, summary: this.summary(app.name) })),
        });
      }
      if (method === 'POST') return this.createProject(me, body);
    }

    const env = path.match(
      /^\/api\/v1\/projects\/([^/]+)\/envs\/([^/]+)(?:\/(versions|rollback)(?:\/(\d+))?)?$/,
    );
    if (env) {
      const [, name = '', envName = '', action, version] = env;
      if (!action && method === 'GET') return this.environment(name, envName);
      if (action === 'versions' && !version && method === 'POST') {
        return this.publish(me, name, envName, body);
      }
      if (action === 'versions' && !version && method === 'GET')
        return this.versions(name, envName);
      if (action === 'versions' && version && method === 'GET') {
        return this.version(name, envName, Number(version));
      }
      if (action === 'rollback' && method === 'POST') return this.rollback(me, name, envName, body);
    }

    const single = path.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (single && method === 'GET') {
      const found = this.state.projects.find((candidate) => candidate.name === single[1]);
      return found
        ? new Reply(200, found)
        : problem(404, 'project_not_found', `프로젝트가 없습니다: ${single[1]}`);
    }

    const schema = path.match(
      /^\/api\/v1\/projects\/([^/]+)\/schema(?:\/(keys|public-prefixes)(?:\/([^/]+))?)?$/,
    );
    if (schema) {
      const [, name = '', part, key] = schema;
      return this.schema(me, method, name, part, key, body);
    }

    if (path.startsWith('/api/v1/targets') || /^\/api\/v1\/projects\/[^/]+\/targets$/.test(path)) {
      return this.targetRoutes(me, method, path, body);
    }
    if (path.startsWith('/api/v1/role-assignments')) {
      return this.assignments(me, method, path, body);
    }
    if (path.startsWith('/api/v1/users')) return this.users(me, method, path, body);

    return problem(404, 'not_found', `목업에 없는 경로: ${method} ${path}`);
  }

  private createProject(me: User, body: Record<string, unknown>): Reply {
    if (me.role !== 'admin') return problem(403, 'admin_required', '관리자만 할 수 있습니다');
    const name = String(body.name ?? '');
    if (name === SHARED_PROJECT_NAME) {
      return problem(422, 'reserved_project_name', `예약된 프로젝트 이름입니다: ${name}`);
    }
    if (!isValidProjectName(name)) {
      return problem(
        422,
        'invalid_project_name',
        `프로젝트 이름은 소문자·숫자·하이픈, 32자 이하여야 합니다: ${JSON.stringify(name)}`,
      );
    }
    if (this.state.projects.some((candidate) => candidate.name === name)) {
      return problem(409, 'project_name_taken', `이미 있는 프로젝트 이름입니다: ${name}`);
    }
    const created = project(name, typeof body.displayName === 'string' ? body.displayName : name);
    this.update((state) => {
      state.projects = [...state.projects, created].sort((a, b) => a.name.localeCompare(b.name));
      state.values[name] = { local: snap(0), development: snap(0), production: snap(0) };
    });
    return new Reply(201, created);
  }

  private environment(name: string, env: string): Reply {
    const values = this.state.values[name];
    if (!values) return problem(404, 'project_not_found', `프로젝트가 없습니다: ${name}`);
    if (!isEnvironmentName(env)) {
      return problem(
        400,
        'invalid_environment',
        '환경은 local, development, production 중 하나여야 합니다',
      );
    }
    return new Reply(200, { project: name, env, ...values[env] });
  }

  /** 서버의 PublishService.summarize와 같은 규칙 */
  private summary(name: string) {
    const values = this.state.values[name];
    const required = this.schemaOf(name).keys.filter((entry) => entry.required);
    const environments = ENVIRONMENT_NAMES.map((env) => {
      const snapshot = values?.[env];
      const latest = snapshot ? historyOf(snapshot).at(-1) : undefined;
      return {
        env,
        version: snapshot?.version ?? 0,
        publishedAt: snapshot?.version ? (latest?.createdAt ?? null) : null,
      };
    });
    const allKeys = new Set([
      ...ENVIRONMENT_NAMES.flatMap((env) => Object.keys(values?.[env]?.variables ?? {})),
      ...required.map((entry) => entry.key),
    ]);
    let missing = 0;
    let missingRequired = 0;
    for (const env of ENVIRONMENT_NAMES) {
      const keys = values?.[env]?.variables ?? {};
      for (const key of allKeys) {
        if (Object.hasOwn(keys, key)) continue;
        missing++;
        const entry = required.find((candidate) => candidate.key === key);
        if (entry && !entry.optionalIn.includes(env)) missingRequired++;
      }
    }
    return { environments, missing, missingRequired };
  }

  private assignments(
    me: User,
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Reply {
    if (me.role !== 'admin') return problem(403, 'admin_required', '관리자만 할 수 있습니다');
    const current = this.state.assignments ?? [];
    if (path === '/api/v1/role-assignments' && method === 'GET') {
      return new Reply(200, { assignments: current });
    }
    const login = decodeURIComponent(path.split('/').at(-1) ?? '').toLowerCase();
    if (method === 'PUT') {
      if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/.test(login)) {
        return problem(
          422,
          'invalid_github_login',
          `GitHub 사용자명 형식이 아닙니다: ${JSON.stringify(login)}`,
        );
      }
      if (this.state.users.some((user) => user.login.toLowerCase() === login)) {
        return problem(
          409,
          'user_exists',
          `이미 로그인한 사용자입니다. 사용자 목록에서 역할을 바꾸세요: ${login}`,
        );
      }
      const entry = {
        login,
        role: body.role === 'admin' ? ('admin' as const) : ('member' as const),
        createdAt: new Date().toISOString(),
      };
      this.update((state) => {
        state.assignments = [...current.filter((other) => other.login !== login), entry].sort(
          (a, b) => a.login.localeCompare(b.login),
        );
      });
      return new Reply(200, entry);
    }
    if (method === 'DELETE') {
      if (!current.some((other) => other.login === login)) {
        return problem(404, 'assignment_not_found', `미리 지정한 역할이 없습니다: ${login}`);
      }
      this.update((state) => {
        state.assignments = current.filter((other) => other.login !== login);
      });
      return new Reply(204);
    }
    return problem(404, 'not_found', `목업에 없는 경로: ${method} ${path}`);
  }

  private targetsState(): MockTargetsState {
    return this.state.targets ?? initialTargets();
  }

  private saveTargets(change: (targets: MockTargetsState) => void) {
    this.update((state) => {
      const targets = structuredClone(state.targets ?? initialTargets());
      change(targets);
      state.targets = targets;
    });
  }

  /** pull·동기화가 받는 값 (공유 참조를 푼 값) */
  private delivered(project: string, env: EnvironmentName) {
    const snapshot = this.state.values[project]?.[env];
    const variables = snapshot?.variables ?? {};
    const sharedSnapshot = this.state.values[SHARED_PROJECT_NAME]?.[env];
    return {
      version: snapshot?.version ?? 0,
      sharedVersion: sharedSnapshot?.version ?? 0,
      variables:
        project === SHARED_PROJECT_NAME
          ? variables
          : resolveSharedReferences(variables, sharedSnapshot?.variables ?? {}).values,
    };
  }

  private buildTimeKeys(project: string) {
    return new Set(
      this.schemaOf(project)
        .keys.filter((entry) => entry.buildTime)
        .map((entry) => entry.key),
    );
  }

  /** 게시하면 자동 매핑에 바로 반영한다 (worker 흉내, 결정 53) */
  private autoSync(project: string, env: EnvironmentName) {
    for (const mapping of this.targetsState().mappings) {
      if (mapping.syncMode !== 'auto' || mapping.env !== env) continue;
      if (project !== SHARED_PROJECT_NAME && mapping.project !== project) continue;
      this.syncMapping(mapping.id, 'publish');
    }
  }

  private syncMapping(id: string, trigger: 'publish' | 'manual'): MockRun | null {
    const mapping = this.targetsState().mappings.find((candidate) => candidate.id === id);
    if (!mapping) return null;
    const delivered = this.delivered(mapping.project, mapping.env);
    const remote = this.targetsState().remote[mapping.resourceId] ?? {};
    const { plan, action, managed } = planFor(
      mapping,
      delivered.variables,
      this.buildTimeKeys(mapping.project),
      remote,
    );
    const changedKeys = [
      ...plan.add.map((v) => v.key),
      ...plan.change.map((v) => v.key),
      ...plan.remove,
    ].sort();
    const now = new Date().toISOString();
    const run: MockRun = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      trigger,
      status: changedKeys.length > 0 ? 'succeeded' : 'skipped',
      version: delivered.version,
      sharedVersion: delivered.sharedVersion,
      changedKeys,
      action: changedKeys.length > 0 ? action : null,
      providerRef: changedKeys.length > 0 ? `dep-${Math.random().toString(36).slice(2, 8)}` : null,
      error: null,
      attempt: 1,
      startedAt: now,
      finishedAt: now,
    };
    this.saveTargets((targets) => {
      const next = { ...(targets.remote[mapping.resourceId] ?? {}) };
      for (const variable of [...plan.add, ...plan.change]) next[variable.key] = variable.value;
      for (const key of plan.remove) delete next[key];
      targets.remote[mapping.resourceId] = next;
      targets.runs[id] = [run, ...(targets.runs[id] ?? [])].slice(0, 20);
      const target = targets.mappings.find((candidate) => candidate.id === id);
      if (target) {
        target.lastSynced = managed;
        target.lastSync = {
          version: delivered.version,
          sharedVersion: delivered.sharedVersion,
          at: now,
        };
        target.driftKeys = [];
      }
    });
    return run;
  }

  private targetRoutes(
    me: User,
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Reply {
    const targets = this.targetsState();
    const adminOnly = () => problem(403, 'admin_required', '관리자만 할 수 있습니다');

    if (path === '/api/v1/targets/providers' && method === 'GET') {
      return new Reply(200, { providers: [MOCK_PROVIDER] });
    }
    const projectTargets = path.match(/^\/api\/v1\/projects\/([^/]+)\/targets$/);
    if (projectTargets) {
      const project = projectTargets[1] ?? '';
      if (method === 'GET') {
        return new Reply(200, {
          mappings: targets.mappings
            .filter((m) => m.project === project)
            .map((m) => mappingView(m, targets)),
        });
      }
      if (method === 'POST') {
        if (me.role !== 'admin') return adminOnly();
        if (project === SHARED_PROJECT_NAME) {
          return problem(422, 'shared_not_deployable', '공유 그룹은 배포 대상에 매핑하지 않습니다');
        }
        const resource = MOCK_RESOURCES.find((candidate) => candidate.id === body.resourceId);
        if (!resource) return problem(404, 'target_resource_not_found', '리소스가 없습니다');
        if (targets.mappings.some((m) => m.resourceId === resource.id)) {
          return problem(
            409,
            'resource_already_mapped',
            `이미 다른 매핑이 쓰는 리소스입니다: ${resource.name}`,
          );
        }
        const mapping: MockMapping = {
          id: `m-${Date.now()}`,
          project,
          env: body.env as EnvironmentName,
          connectionId: String(body.connectionId),
          resourceId: resource.id,
          resourceName: resource.name,
          syncMode: body.syncMode === 'manual' ? 'manual' : 'auto',
          afterSync: (body.afterSync as MockMapping['afterSync']) ?? 'auto',
          unmanaged: body.unmanaged === 'delete' ? 'delete' : 'keep',
          include: (body.include as string[]) ?? [],
          exclude: (body.exclude as string[]) ?? [],
          options: (body.options as Record<string, unknown>) ?? {},
          lastSynced: null,
          lastSync: null,
          driftKeys: [],
          driftCheckedAt: null,
        };
        this.saveTargets((next) => next.mappings.push(mapping));
        return new Reply(201, mappingView(mapping, this.targetsState()));
      }
    }

    if (path === '/api/v1/targets/connections') {
      if (me.role !== 'admin') return adminOnly();
      if (method === 'GET') {
        return new Reply(200, {
          connections: targets.connections.map((c) => connectionView(c, targets)),
        });
      }
      if (method === 'POST') {
        const config = (body.config ?? {}) as { url?: string; token?: string };
        if (config.token === 'bad')
          return problem(422, 'target_auth_failed', 'Coolify가 API 토큰을 거부했습니다');
        if (!config.url || !config.token)
          return problem(422, 'invalid_target_config', '주소와 토큰이 필요합니다');
        const now = new Date().toISOString();
        const connection: MockConnection = {
          id: `c-${Date.now()}`,
          name: String(body.name),
          type: 'coolify',
          config: { url: config.url },
          createdAt: now,
          updatedAt: now,
        };
        this.saveTargets((next) => next.connections.push(connection));
        return new Reply(201, connectionView(connection, this.targetsState()));
      }
    }
    const connectionMatch = path.match(
      /^\/api\/v1\/targets\/connections\/([^/]+)(?:\/(test|resources))?$/,
    );
    if (connectionMatch) {
      if (me.role !== 'admin') return adminOnly();
      const [, id, action] = connectionMatch;
      const connection = targets.connections.find((candidate) => candidate.id === id);
      if (!connection) return problem(404, 'connection_not_found', '배포 대상 연결이 없습니다');
      if (action === 'test' && method === 'POST') return new Reply(204);
      if (action === 'resources' && method === 'GET')
        return new Reply(200, { resources: MOCK_RESOURCES });
      if (!action && method === 'PATCH') {
        this.saveTargets((next) => {
          const target = next.connections.find((candidate) => candidate.id === id);
          if (target && typeof body.name === 'string') target.name = body.name;
          const url = (body.config as { url?: string } | undefined)?.url;
          if (target && url) target.config.url = url;
        });
        const updated = this.targetsState().connections.find((candidate) => candidate.id === id);
        return new Reply(200, updated ? connectionView(updated, this.targetsState()) : {});
      }
      if (!action && method === 'DELETE') {
        if (targets.mappings.some((m) => m.connectionId === id)) {
          return problem(
            409,
            'connection_in_use',
            '매핑이 있는 연결은 지울 수 없습니다. 매핑을 먼저 지우세요',
          );
        }
        this.saveTargets((next) => {
          next.connections = next.connections.filter((candidate) => candidate.id !== id);
        });
        return new Reply(204);
      }
    }

    const mappingMatch = path.match(
      /^\/api\/v1\/targets\/mappings\/([^/]+)(?:\/(plan|sync|runs|import|drift))?$/,
    );
    if (mappingMatch) {
      const [, id = '', action] = mappingMatch;
      const mapping = targets.mappings.find((candidate) => candidate.id === id);
      if (!mapping) return problem(404, 'mapping_not_found', '배포 대상 매핑이 없습니다');
      if (!action && (method === 'PATCH' || method === 'DELETE') && me.role !== 'admin')
        return adminOnly();
      if (!action && method === 'DELETE') {
        this.saveTargets((next) => {
          next.mappings = next.mappings.filter((candidate) => candidate.id !== id);
        });
        return new Reply(204);
      }
      if (!action && method === 'PATCH') {
        this.saveTargets((next) => {
          const target = next.mappings.find((candidate) => candidate.id === id);
          if (target) Object.assign(target, body);
        });
        const updated = this.targetsState().mappings.find((candidate) => candidate.id === id);
        return new Reply(200, updated ? mappingView(updated, this.targetsState()) : {});
      }
      if (action === 'plan' && method === 'GET') {
        const delivered = this.delivered(mapping.project, mapping.env);
        const { plan, action: after } = planFor(
          mapping,
          delivered.variables,
          this.buildTimeKeys(mapping.project),
          targets.remote[mapping.resourceId] ?? {},
        );
        return new Reply(200, {
          version: delivered.version,
          sharedVersion: delivered.sharedVersion,
          add: plan.add.map((v) => v.key),
          change: plan.change.map((v) => v.key),
          remove: plan.remove,
          unchanged: plan.unchanged.length,
          action: after,
        });
      }
      if (action === 'sync' && method === 'POST')
        return new Reply(200, this.syncMapping(id, 'manual'));
      if (action === 'runs' && method === 'GET')
        return new Reply(200, { runs: targets.runs[id] ?? [] });
      if (action === 'drift' && method === 'POST') {
        const remote = targets.remote[mapping.resourceId] ?? {};
        const driftKeys = Object.entries(mapping.lastSynced ?? {})
          .filter(([key, value]) => remote[key] !== value)
          .map(([key]) => key)
          .sort();
        this.saveTargets((next) => {
          const target = next.mappings.find((candidate) => candidate.id === id);
          if (target) {
            target.driftKeys = driftKeys;
            target.driftCheckedAt = new Date().toISOString();
          }
        });
        return new Reply(200, { driftKeys });
      }
      if (action === 'import' && method === 'POST') {
        const remote = targets.remote[mapping.resourceId] ?? {};
        const current = this.state.values[mapping.project]?.[mapping.env];
        const set = Object.fromEntries(
          Object.entries(remote).filter(
            ([key, value]) =>
              matchesKeyFilter(key, mapping.include, mapping.exclude) &&
              current?.variables[key] !== value,
          ),
        );
        if (Object.keys(set).length === 0) return problem(422, 'no_changes', '바뀐 값이 없습니다');
        const reply = this.publish(me, mapping.project, mapping.env, {
          baseVersion: current?.version ?? 0,
          changes: { set },
          message: `${mapping.resourceName}에서 가져옴`,
        });
        if (reply.status !== 201) return reply;
        return new Reply(201, {
          version: (reply.body as { version: number }).version,
          keys: Object.keys(set).sort(),
        });
      }
    }
    return problem(404, 'not_found', `목업에 없는 경로: ${method} ${path}`);
  }

  private schemaOf(name: string): ProjectSchema {
    return this.state.schemas?.[name] ?? { publicPrefixes: [], keys: [] };
  }

  private schema(
    me: User,
    method: string,
    name: string,
    part: string | undefined,
    key: string | undefined,
    body: Record<string, unknown>,
  ): Reply {
    if (!this.state.projects.some((candidate) => candidate.name === name)) {
      return problem(404, 'project_not_found', `프로젝트가 없습니다: ${name}`);
    }
    const current = this.schemaOf(name);
    const save = (next: ProjectSchema) =>
      this.update((state) => {
        state.schemas = { ...state.schemas, [name]: next };
      });

    if (!part && method === 'GET') return new Reply(200, current);
    if (part === 'public-prefixes' && method === 'PUT') {
      if (me.role !== 'admin') return problem(403, 'admin_required', '관리자만 할 수 있습니다');
      const prefixes = Array.isArray(body.publicPrefixes) ? body.publicPrefixes.map(String) : [];
      const invalid = prefixes.find((prefix) => !isValidPublicPrefix(prefix));
      if (invalid !== undefined) {
        return problem(
          422,
          'invalid_public_prefix',
          `공개 접두사는 대문자로 시작하고 밑줄로 끝나야 합니다 (예: VITE_): ${JSON.stringify(invalid)}`,
        );
      }
      const publicPrefixes = [...new Set(prefixes)];
      save({ ...current, publicPrefixes });
      return new Reply(200, { publicPrefixes });
    }
    if (part === 'keys' && key && method === 'PUT') {
      if (!isValidKeyName(key)) {
        return problem(
          422,
          'invalid_key_name',
          `키 이름은 대문자·숫자·밑줄만 쓸 수 있고 숫자로 시작할 수 없습니다: ${JSON.stringify(key)}`,
        );
      }
      const entry = schemaKey(key, {
        ...(body as Partial<KeySchema>),
        description: typeof body.description === 'string' ? body.description.trim() : '',
      });
      const keys = [...current.keys.filter((other) => other.key !== key), entry].sort((a, b) =>
        a.key.localeCompare(b.key),
      );
      save({ ...current, keys });
      return new Reply(200, entry);
    }
    if (part === 'keys' && key && method === 'DELETE') {
      if (!current.keys.some((other) => other.key === key)) {
        return problem(404, 'key_schema_not_found', `키 스키마가 없습니다: ${key}`);
      }
      save({ ...current, keys: current.keys.filter((other) => other.key !== key) });
      return new Reply(204);
    }
    return problem(404, 'not_found', `목업에 없는 경로: ${method} ${name}/schema`);
  }

  private versions(name: string, env: string): Reply {
    const snapshot = this.state.values[name]?.[env as EnvironmentName];
    if (!snapshot) return problem(404, 'project_not_found', `프로젝트가 없습니다: ${name}`);
    const logins = new Map(this.state.users.map((user) => [user.id, user.login]));
    const versions = [...historyOf(snapshot)].reverse().map((item) => ({
      version: item.version,
      message: item.message,
      createdAt: item.createdAt,
      author: { id: item.createdBy, login: logins.get(item.createdBy) ?? null },
    }));
    return new Reply(200, { versions });
  }

  private version(name: string, env: string, version: number): Reply {
    const snapshot = this.state.values[name]?.[env as EnvironmentName];
    if (!snapshot) return problem(404, 'project_not_found', `프로젝트가 없습니다: ${name}`);
    const found = historyOf(snapshot).find((item) => item.version === version);
    if (!found) return problem(404, 'version_not_found', `버전이 없습니다: v${version}`);
    return new Reply(200, { project: name, env, version, variables: found.variables });
  }

  private rollback(me: User, name: string, env: string, body: Record<string, unknown>): Reply {
    const snapshot = this.state.values[name]?.[env as EnvironmentName];
    if (!snapshot) return problem(404, 'project_not_found', `프로젝트가 없습니다: ${name}`);
    const toVersion = Number(body.toVersion);
    const target = historyOf(snapshot).find((item) => item.version === toVersion);
    if (!target) return problem(404, 'version_not_found', `버전이 없습니다: v${toVersion}`);
    return this.publish(me, name, env, {
      baseVersion: body.baseVersion,
      changes: createChangeSet(snapshot.variables, target.variables),
      message: typeof body.message === 'string' ? body.message : `${versionRo(toVersion)} 되돌림`,
    });
  }

  private publish(me: User, name: string, env: string, body: Record<string, unknown>): Reply {
    const values = this.state.values[name];
    if (!values) return problem(404, 'project_not_found', `프로젝트가 없습니다: ${name}`);
    if (!isEnvironmentName(env)) {
      return problem(
        400,
        'invalid_environment',
        '환경은 local, development, production 중 하나여야 합니다',
      );
    }
    const current = values[env];
    const baseVersion = Number(body.baseVersion);
    if (baseVersion !== current.version) {
      return problem(
        409,
        'version_conflict',
        `그 사이 다른 게시가 있었습니다 (기준 v${baseVersion}, 현재 v${current.version})`,
        { baseVersion, currentVersion: current.version },
      );
    }

    const next = applyChangeSet(current.variables, (body.changes ?? {}) as ChangeSet);
    const diff = diffVariables(current.variables, next);
    if (!hasChanges(diff)) return problem(422, 'no_changes', '바뀐 값이 없습니다');

    const issues: object[] = Object.keys(next)
      .filter((key) => !isValidKeyName(key))
      .map((key) => ({ code: 'invalid_key_name', key }));
    if (name === SHARED_PROJECT_NAME) {
      const referencing = new Set(
        resolveSharedReferences(next, {}).issues.map((issue) => issue.key),
      );
      for (const key of referencing) issues.push({ code: 'reference_in_shared_group', key });
    } else {
      const shared = this.state.values[SHARED_PROJECT_NAME]?.[env].variables ?? {};
      issues.push(...resolveSharedReferences(next, shared).issues);
    }
    const resolved =
      name === SHARED_PROJECT_NAME
        ? next
        : resolveSharedReferences(
            next,
            this.state.values[SHARED_PROJECT_NAME]?.[env].variables ?? {},
          ).values;
    for (const issue of validateEnvironment(this.schemaOf(name).keys, resolved, env)) {
      if (issue.code === 'missing_required') issues.push({ code: issue.code, key: issue.key });
      if (issue.code === 'invalid_type') {
        issues.push({ code: issue.code, key: issue.key, expected: issue.expected });
      }
    }
    if (issues.length > 0) {
      return problem(422, 'publish_validation', `게시할 수 없습니다: 문제 ${issues.length}건`, {
        issues,
      });
    }

    const version = current.version + 1;
    this.update((state) => {
      const target = state.values[name];
      if (!target) return;
      const entry: VersionRecord = {
        version,
        variables: next,
        message: typeof body.message === 'string' ? body.message : '',
        createdBy: me.id,
        createdAt: new Date().toISOString(),
      };
      target[env] = { version, variables: next, history: [...historyOf(target[env]), entry] };
    });
    this.autoSync(name, env as EnvironmentName);
    return new Reply(201, { version, diff });
  }

  private users(me: User, method: string, path: string, body: Record<string, unknown>): Reply {
    if (me.role !== 'admin') return problem(403, 'admin_required', '관리자만 할 수 있습니다');
    if (path === '/api/v1/users' && method === 'GET') {
      const rank = (candidate: User) => (candidate.status === 'pending' ? 0 : 1);
      return new Reply(200, { users: [...this.state.users].sort((a, b) => rank(a) - rank(b)) });
    }

    const match = path.match(/^\/api\/v1\/users\/([^/]+)\/(activate|disable|role)$/);
    const target = match && this.state.users.find((candidate) => candidate.id === match[1]);
    if (!match || !target) return problem(404, 'user_not_found', '사용자가 없습니다');
    const action = match[2];

    const otherActiveAdmins = this.state.users.filter(
      (candidate) =>
        candidate.id !== target.id && candidate.role === 'admin' && candidate.status === 'active',
    ).length;
    const lastAdmin = problem(
      422,
      'last_admin',
      '마지막 활성 관리자는 강등하거나 비활성화할 수 없습니다',
    );

    let changed: User;
    if (action === 'activate' && method === 'POST') {
      changed = { ...target, status: 'active' };
    } else if (action === 'disable' && method === 'POST') {
      if (target.id === me.id) {
        return problem(422, 'cannot_disable_self', '자기 자신은 비활성화할 수 없습니다');
      }
      if (target.role === 'admin' && otherActiveAdmins === 0) return lastAdmin;
      changed = { ...target, status: 'disabled' };
    } else if (action === 'role' && method === 'PUT') {
      const role = body.role === 'admin' ? 'admin' : 'member';
      if (role === 'member' && target.role === 'admin' && otherActiveAdmins === 0) return lastAdmin;
      changed = { ...target, role };
    } else {
      return problem(404, 'not_found', `목업에 없는 경로: ${method} ${path}`);
    }

    this.update((state) => {
      state.users = state.users.map((candidate) =>
        candidate.id === changed.id ? changed : candidate,
      );
    });
    return new Reply(200, changed);
  }
}
