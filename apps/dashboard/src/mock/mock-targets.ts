import {
  computeSyncPlan,
  decideAction,
  type EnvironmentName,
  matchesKeyFilter,
  type TargetCapabilities,
} from '@senv/core';

/**
 * 목업의 배포 대상 (결정 37·56). 가짜 Coolify 하나와 그 앱들의 원격 값을 브라우저 안에서 흉내 낸다.
 * 값을 풀어 쓰는 일과 게시는 목업 서버가 맡고, 여기서는 계획·반영·기록만 한다.
 */

export const MOCK_CAPABILITIES: TargetCapabilities = {
  readValues: true,
  deleteKeys: true,
  actions: ['restart', 'redeploy'],
  buildTimeFlag: true,
};

export const MOCK_PROVIDER = {
  type: 'coolify',
  displayName: 'Coolify',
  capabilities: MOCK_CAPABILITIES,
  connectionFields: [
    { name: 'url', label: 'Coolify 주소', kind: 'url', required: true },
    { name: 'token', label: 'API 토큰', kind: 'secret', required: true },
  ],
  mappingOptionFields: [{ name: 'preview', label: 'Preview 배포에도 넣기', kind: 'boolean' }],
} as const;

export const MOCK_RESOURCES = [
  { id: 'app-api', name: 'stream-api-prod', description: 'https://api.stream.example' },
  { id: 'app-web', name: 'stream-web-prod', description: 'https://stream.example' },
  { id: 'app-api-dev', name: 'stream-api-dev', description: 'https://api.dev.stream.example' },
];

export interface MockRun {
  id: string;
  trigger: 'publish' | 'manual';
  status: 'succeeded' | 'skipped' | 'failed';
  version: number;
  sharedVersion: number;
  changedKeys: string[];
  action: 'restart' | 'redeploy' | null;
  providerRef: string | null;
  error: string | null;
  attempt: number;
  startedAt: string;
  finishedAt: string;
}

export interface MockMapping {
  id: string;
  project: string;
  env: EnvironmentName;
  connectionId: string;
  resourceId: string;
  resourceName: string;
  syncMode: 'auto' | 'manual';
  afterSync: 'auto' | 'none' | 'restart' | 'redeploy';
  unmanaged: 'keep' | 'delete';
  include: string[];
  exclude: string[];
  options: Record<string, unknown>;
  /** 마지막으로 반영한 값 (드리프트 비교용, 목업이라 값을 그대로 둔다) */
  lastSynced: Record<string, string> | null;
  lastSync: { version: number; sharedVersion: number; at: string } | null;
  driftKeys: string[];
  driftCheckedAt: string | null;
}

export interface MockConnection {
  id: string;
  name: string;
  type: 'coolify';
  config: { url: string };
  createdAt: string;
  updatedAt: string;
}

export interface MockTargetsState {
  connections: MockConnection[];
  mappings: MockMapping[];
  runs: Record<string, MockRun[]>;
  /** 리소스별 원격 값 */
  remote: Record<string, Record<string, string>>;
}

export function initialTargets(): MockTargetsState {
  const at = '2026-10-05T09:00:00.000Z';
  const mapping = (
    fields: Partial<MockMapping> & Pick<MockMapping, 'id' | 'project' | 'env' | 'resourceId'>,
  ) => ({
    connectionId: 'c-coolify',
    resourceName: MOCK_RESOURCES.find((resource) => resource.id === fields.resourceId)?.name ?? '',
    syncMode: 'auto' as const,
    afterSync: 'auto' as const,
    unmanaged: 'keep' as const,
    include: [],
    exclude: [],
    options: {},
    lastSynced: null,
    lastSync: null,
    driftKeys: [],
    driftCheckedAt: null,
    ...fields,
  });
  return {
    connections: [
      {
        id: 'c-coolify',
        name: 'coolify-main',
        type: 'coolify',
        config: { url: 'https://coolify.stream.example' },
        createdAt: at,
        updatedAt: at,
      },
    ],
    mappings: [
      mapping({ id: 'm-api', project: 'server', env: 'production', resourceId: 'app-api' }),
      mapping({
        id: 'm-web',
        project: 'web',
        env: 'production',
        resourceId: 'app-web',
        syncMode: 'manual',
      }),
    ],
    runs: {},
    remote: {
      // Coolify에 손으로 넣어 둔 예전 값
      'app-api': { API_PORT: '8080', LOG_LEVEL: 'debug', OLD_FLAG: 'x' },
      'app-web': {},
      'app-api-dev': {},
    },
  };
}

/** 원하는 값과 원격 값을 견줘 계획과 반영 후 동작을 만든다 (서버의 SyncService.plan과 같은 규칙) */
export function planFor(
  mapping: MockMapping,
  desired: Record<string, string>,
  buildTimeKeys: Set<string>,
  remote: Record<string, string>,
) {
  const wanted = Object.entries(desired).map(([key, value]) => ({
    key,
    value,
    buildTime: buildTimeKeys.has(key),
    multiline: value.includes('\n'),
  }));
  const current = Object.entries(remote).map(([key, value]) => ({
    key,
    value,
    buildTime: buildTimeKeys.has(key),
  }));
  const plan = computeSyncPlan(
    wanted,
    current,
    { unmanaged: mapping.unmanaged, include: mapping.include, exclude: mapping.exclude },
    MOCK_CAPABILITIES,
  );
  const managed = Object.fromEntries(
    Object.entries(desired).filter(([key]) =>
      matchesKeyFilter(key, mapping.include, mapping.exclude),
    ),
  );
  return { plan, action: decideAction(plan, mapping.afterSync, MOCK_CAPABILITIES), managed };
}

export function mappingView(mapping: MockMapping, state: MockTargetsState) {
  const connection = state.connections.find((candidate) => candidate.id === mapping.connectionId);
  const run = state.runs[mapping.id]?.[0];
  return {
    id: mapping.id,
    project: mapping.project,
    env: mapping.env,
    connection: { id: mapping.connectionId, name: connection?.name ?? '', type: 'coolify' },
    resourceId: mapping.resourceId,
    resourceName: mapping.resourceName,
    syncMode: mapping.syncMode,
    afterSync: mapping.afterSync,
    unmanaged: mapping.unmanaged,
    include: mapping.include,
    exclude: mapping.exclude,
    options: mapping.options,
    lastSync: mapping.lastSync,
    lastRun: run
      ? {
          status: run.status,
          trigger: run.trigger,
          action: run.action,
          error: run.error,
          at: run.finishedAt,
        }
      : null,
    driftKeys: mapping.driftKeys,
    driftCheckedAt: mapping.driftCheckedAt,
  };
}

export function connectionView(connection: MockConnection, state: MockTargetsState) {
  return {
    ...connection,
    mappingCount: state.mappings.filter((mapping) => mapping.connectionId === connection.id).length,
  };
}
