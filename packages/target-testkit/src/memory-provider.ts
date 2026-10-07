import {
  type ApplyResult,
  type FieldSpec,
  InvalidTargetConfigError,
  type RemoteVariable,
  type SyncPlan,
  type TargetAction,
  TargetAuthError,
  type TargetCapabilities,
  TargetNotFoundError,
  type TargetProvider,
  type TargetResource,
} from '@senv/core';

export interface MemoryConnection {
  token: string;
}

export type MemoryOptions = Record<string, never>;

export interface MemoryProviderOptions {
  resources: TargetResource[];
  capabilities?: Partial<TargetCapabilities>;
  /** testConnection이 받아 주는 토큰 */
  validToken?: string;
}

interface StoredVariable {
  value: string;
  buildTime: boolean;
}

/**
 * 테스트용 메모리 제공자 (PRD 8.1). 엔진·대시보드 테스트가 Coolify 없이 전체 흐름을 돌린다.
 * 반영한 값과 실행한 동작을 기록하고, 다음 호출을 실패하게 할 수 있다.
 */
export class MemoryTargetProvider implements TargetProvider<MemoryConnection, MemoryOptions> {
  readonly type = 'memory';
  readonly displayName = '메모리 (테스트용)';
  readonly capabilities: TargetCapabilities;
  readonly connectionFields: FieldSpec[] = [
    { name: 'token', label: '토큰', kind: 'secret', required: true },
  ];
  readonly mappingOptionFields: FieldSpec[] = [];
  readonly actions: { resourceId: string; action: TargetAction }[] = [];

  private readonly resources: TargetResource[];
  private readonly validToken: string;
  private readonly variables = new Map<string, Map<string, StoredVariable>>();
  private pendingFailure: Error | undefined;

  constructor(options: MemoryProviderOptions) {
    this.resources = options.resources;
    this.validToken = options.validToken ?? 'test-token';
    this.capabilities = {
      readValues: true,
      deleteKeys: true,
      actions: ['restart', 'redeploy'],
      buildTimeFlag: true,
      ...options.capabilities,
    };
  }

  /** 원격에 이미 있는 값을 넣어 둔다 */
  seed(resourceId: string, values: Record<string, string>, buildTime = false) {
    const stored = this.store(resourceId);
    for (const [key, value] of Object.entries(values)) stored.set(key, { value, buildTime });
  }

  variablesOf(resourceId: string): Record<string, string> {
    return Object.fromEntries([...this.store(resourceId)].map(([key, { value }]) => [key, value]));
  }

  buildTimeOf(resourceId: string, key: string): boolean | undefined {
    return this.store(resourceId).get(key)?.buildTime;
  }

  /** 다음 호출 하나를 이 오류로 실패하게 한다 */
  failNext(error: Error) {
    this.pendingFailure = error;
  }

  parseConnection(input: unknown): MemoryConnection {
    const token = (input as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || token === '') {
      throw new InvalidTargetConfigError('토큰이 필요합니다');
    }
    return { token };
  }

  parseMappingOptions(): MemoryOptions {
    return {};
  }

  async testConnection(connection: MemoryConnection): Promise<void> {
    this.check(connection);
  }

  async listResources(connection: MemoryConnection): Promise<TargetResource[]> {
    this.check(connection);
    return this.resources;
  }

  async readVariables(connection: MemoryConnection, resourceId: string): Promise<RemoteVariable[]> {
    this.check(connection, resourceId);
    return [...this.store(resourceId)].map(([key, { value, buildTime }]) => ({
      key,
      value: this.capabilities.readValues ? value : null,
      buildTime,
    }));
  }

  async applyPlan(
    connection: MemoryConnection,
    resourceId: string,
    plan: SyncPlan,
    _options?: MemoryOptions,
  ): Promise<ApplyResult> {
    this.check(connection, resourceId);
    const stored = this.store(resourceId);
    for (const variable of [...plan.add, ...plan.change]) {
      stored.set(variable.key, { value: variable.value, buildTime: variable.buildTime });
    }
    for (const key of plan.remove) stored.delete(key);
    return {};
  }

  async runAction(
    connection: MemoryConnection,
    resourceId: string,
    action: TargetAction,
  ): Promise<ApplyResult> {
    this.check(connection, resourceId);
    if (!this.capabilities.actions.includes(action)) {
      throw new Error(`지원하지 않는 동작입니다: ${action}`);
    }
    this.actions.push({ resourceId, action });
    return { ref: `${action}-${this.actions.length}` };
  }

  private check(connection: MemoryConnection, resourceId?: string) {
    const failure = this.pendingFailure;
    if (failure) {
      this.pendingFailure = undefined;
      throw failure;
    }
    if (connection.token !== this.validToken) throw new TargetAuthError('토큰이 올바르지 않습니다');
    if (
      resourceId !== undefined &&
      !this.resources.some((resource) => resource.id === resourceId)
    ) {
      throw new TargetNotFoundError(`리소스가 없습니다: ${resourceId}`);
    }
  }

  private store(resourceId: string): Map<string, StoredVariable> {
    let stored = this.variables.get(resourceId);
    if (!stored) {
      stored = new Map();
      this.variables.set(resourceId, stored);
    }
    return stored;
  }
}
