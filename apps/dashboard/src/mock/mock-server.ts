// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 쓴다
import type { ApiSchemas } from '@senv/api-client';
import {
  applyChangeSet,
  type ChangeSet,
  diffVariables,
  ENVIRONMENT_NAMES,
  type EnvironmentName,
  hasChanges,
  isEnvironmentName,
  isValidKeyName,
  isValidProjectName,
  resolveSharedReferences,
  SHARED_PROJECT_NAME,
} from '@senv/core';

/**
 * 디자인 확인용 목업 서버 (`pnpm dev:mock`). 서버·DB·GitHub 없이 브라우저 안에서 API를 흉내 낸다.
 * 프로덕션 빌드에는 들어가지 않는다 (main.tsx에서 mock 모드일 때만 불러온다).
 */

type User = ApiSchemas['User'];
type Project = ApiSchemas['Project'];

export type MockPersona = 'admin' | 'member' | 'pending' | 'signed-out';
type SignedInPersona = Exclude<MockPersona, 'signed-out'>;

interface Snapshot {
  version: number;
  variables: Record<string, string>;
}

export interface MockState {
  persona: MockPersona;
  /** 로그아웃했다가 다시 로그인할 때 돌아갈 역할 */
  lastPersona: SignedInPersona;
  users: User[];
  projects: Project[];
  values: Record<string, Record<EnvironmentName, Snapshot>>;
}

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
});

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

    const reply = this.route(request.method, url.pathname, body);
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

  private route(method: string, path: string, body: Record<string, unknown>): Reply {
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
      if (method === 'GET') return new Reply(200, { projects: this.state.projects });
      if (method === 'POST') return this.createProject(me, body);
    }

    const env = path.match(/^\/api\/v1\/projects\/([^/]+)\/envs\/([^/]+)(\/versions)?$/);
    if (env) {
      const [, name = '', envName = '', versions] = env;
      if (versions && method === 'POST') return this.publish(name, envName, body);
      if (!versions && method === 'GET') return this.environment(name, envName);
    }

    const single = path.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (single && method === 'GET') {
      const found = this.state.projects.find((candidate) => candidate.name === single[1]);
      return found
        ? new Reply(200, found)
        : problem(404, 'project_not_found', `프로젝트가 없습니다: ${single[1]}`);
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

  private publish(name: string, env: string, body: Record<string, unknown>): Reply {
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
    if (issues.length > 0) {
      return problem(422, 'publish_validation', `게시할 수 없습니다: 문제 ${issues.length}건`, {
        issues,
      });
    }

    const version = current.version + 1;
    this.update((state) => {
      const target = state.values[name];
      if (target) target[env] = { version, variables: next };
    });
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
