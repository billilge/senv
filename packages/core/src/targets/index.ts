/**
 * 배포 대상 제공자 공통 인터페이스 (PRD 8.1). 인프라 지식은 없고, 제공자 패키지가 구현한다.
 * 연결·매핑 옵션 폼은 필드 명세로 내주고 검증은 제공자가 한다 (결정 50).
 */

export type TargetAction = 'restart' | 'redeploy';

export interface TargetCapabilities {
  /** 원격 값을 읽을 수 있나 (드리프트 감지, 초기 가져오기) */
  readValues: boolean;
  /** 관리 밖 키를 지울 수 있나 */
  deleteKeys: boolean;
  actions: TargetAction[];
  /** 빌드 시점 변수를 따로 표시할 수 있나 */
  buildTimeFlag: boolean;
}

/** 대시보드가 연결·매핑 옵션 폼을 그릴 때 쓰는 필드 명세 */
export interface FieldSpec {
  name: string;
  label: string;
  kind: 'text' | 'url' | 'secret' | 'boolean';
  required?: boolean;
  description?: string;
}

/** 값을 넣을 대상 하나 (예: Coolify Application) */
export interface TargetResource {
  id: string;
  name: string;
  description?: string;
}

export interface RemoteVariable {
  key: string;
  /** 원격 값. 읽을 수 없는 제공자는 null */
  value: string | null;
  buildTime: boolean;
  /** 값을 읽을 수 없을 때, 지난 동기화 이후 바뀌지 않았다고 엔진이 판단했는지 */
  unchanged?: boolean;
}

/** 제공자에게 넘기는 값. 인프라와 무관한 공통 속성만 담는다 */
export interface DesiredVariable {
  key: string;
  value: string;
  buildTime: boolean;
  multiline: boolean;
}

export interface SyncPlan {
  add: DesiredVariable[];
  change: DesiredVariable[];
  remove: string[];
  unchanged: string[];
}

export interface ApplyResult {
  /** 제공자가 돌려준 참조 (예: 작업 ID) */
  ref?: string;
}

export interface TargetProvider<Conn = unknown, Opts = unknown> {
  type: string;
  displayName: string;
  capabilities: TargetCapabilities;
  connectionFields: FieldSpec[];
  mappingOptionFields: FieldSpec[];
  /** 저장·호출 전에 연결 설정을 검증한다. 틀리면 InvalidTargetConfigError */
  parseConnection(input: unknown): Conn;
  parseMappingOptions(input: unknown): Opts;
  testConnection(connection: Conn): Promise<void>;
  listResources(connection: Conn): Promise<TargetResource[]>;
  readVariables(connection: Conn, resourceId: string): Promise<RemoteVariable[]>;
  applyPlan(
    connection: Conn,
    resourceId: string,
    plan: SyncPlan,
    options: Opts,
  ): Promise<ApplyResult>;
  runAction?(connection: Conn, resourceId: string, action: TargetAction): Promise<ApplyResult>;
}

/** 연결 설정이나 매핑 옵션이 틀림 */
export class InvalidTargetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTargetConfigError';
  }
}

/** 인프라가 자격 증명을 거부함 (401·403) */
export class TargetAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetAuthError';
  }
}

/** 리소스를 찾을 수 없음 */
export class TargetNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetNotFoundError';
  }
}

/** 인프라에 닿지 못하거나 인프라가 실패함. 다시 시도할 수 있다 */
export class TargetUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetUnavailableError';
  }
}

export interface SyncOptions {
  /** 관리 밖 키(원격에만 있는 키)를 둘지 지울지 */
  unmanaged: 'keep' | 'delete';
  /** 포함 패턴. 비우면 모두 포함 (`*`는 아무 글자) */
  include: string[];
  /** 제외 패턴 (예: `SENTRY_*`) */
  exclude: string[];
}

export type AfterSync = 'auto' | 'none' | TargetAction;

const toRegExp = (pattern: string) =>
  new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);
const escapeRegExp = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

export function matchesKeyFilter(key: string, include: string[], exclude: string[]): boolean {
  if (include.length > 0 && !include.some((pattern) => toRegExp(pattern).test(key))) return false;
  return !exclude.some((pattern) => toRegExp(pattern).test(key));
}

/**
 * 동기화 계획 (PRD 8.2). 키 필터 밖의 키는 보내지도 지우지도 않는다.
 * 원격 값을 읽을 수 없으면 엔진이 지난 동기화 해시와 견줘 `unchanged`를 채워 넘긴다.
 */
export function computeSyncPlan(
  desired: DesiredVariable[],
  remote: RemoteVariable[],
  options: SyncOptions,
  capabilities: TargetCapabilities,
): SyncPlan {
  const inScope = (key: string) => matchesKeyFilter(key, options.include, options.exclude);
  const remoteByKey = new Map(
    remote.filter((entry) => inScope(entry.key)).map((entry) => [entry.key, entry]),
  );
  const plan: SyncPlan = { add: [], change: [], remove: [], unchanged: [] };

  for (const variable of [...desired].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    if (!inScope(variable.key)) continue;
    const current = remoteByKey.get(variable.key);
    if (!current) {
      plan.add.push(variable);
      continue;
    }
    const sameValue =
      current.value === null ? current.unchanged === true : current.value === variable.value;
    const sameFlag = !capabilities.buildTimeFlag || current.buildTime === variable.buildTime;
    if (sameValue && sameFlag) plan.unchanged.push(variable.key);
    else plan.change.push(variable);
  }

  if (options.unmanaged === 'delete' && capabilities.deleteKeys) {
    const wanted = new Set(desired.map((variable) => variable.key));
    plan.remove = [...remoteByKey.keys()].filter((key) => !wanted.has(key)).sort();
  }
  return plan;
}

/**
 * 반영 후 동작 (PRD 8.2). 바뀐 것이 없으면 아무것도 하지 않는다(멱등).
 * 자동이면 바뀐 키 중 빌드 시점 값이 있을 때 재배포, 아니면 재시작이다.
 */
export function decideAction(
  plan: SyncPlan,
  afterSync: AfterSync,
  capabilities: TargetCapabilities,
): TargetAction | null {
  const changed = plan.add.length + plan.change.length + plan.remove.length > 0;
  if (!changed || afterSync === 'none') return null;
  const supported = (action: TargetAction) => capabilities.actions.includes(action);
  if (afterSync !== 'auto') return supported(afterSync) ? afterSync : null;

  const needsBuild = [...plan.add, ...plan.change].some((variable) => variable.buildTime);
  const preferred: TargetAction[] = needsBuild ? ['redeploy'] : ['restart', 'redeploy'];
  return preferred.find(supported) ?? null;
}
