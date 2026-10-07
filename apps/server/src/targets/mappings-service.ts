import {
  type AfterSync,
  type EnvironmentName,
  InvalidTargetConfigError,
  SHARED_PROJECT_NAME,
  TargetNotFoundError,
} from '@senv/core';
import { isUniqueViolation } from '../database/errors.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectNotFoundError } from '../projects/projects-service.js';
import type { ConnectionsService } from './connections-service.js';
import type { AnyProvider } from './target-registry.js';

export type SyncMode = 'auto' | 'manual';
export type UnmanagedKeys = 'keep' | 'delete';

export interface MappingInput {
  connectionId: string;
  env: EnvironmentName;
  resourceId: string;
  syncMode?: SyncMode;
  afterSync?: AfterSync;
  unmanaged?: UnmanagedKeys;
  include?: string[];
  exclude?: string[];
  options?: Record<string, unknown>;
}

export type MappingUpdate = Partial<Omit<MappingInput, 'connectionId' | 'resourceId'>>;

export interface MappingView {
  id: string;
  project: string;
  env: EnvironmentName;
  connection: { id: string; name: string; type: string };
  resourceId: string;
  resourceName: string;
  syncMode: SyncMode;
  afterSync: AfterSync;
  unmanaged: UnmanagedKeys;
  include: string[];
  exclude: string[];
  options: Record<string, unknown>;
  lastSync: { version: number; sharedVersion: number; at: Date } | null;
  lastRun: {
    status: 'succeeded' | 'skipped' | 'failed';
    trigger: 'publish' | 'manual';
    action: string | null;
    error: string | null;
    at: Date;
  } | null;
  /** 인프라에서 직접 바뀐 키 (드리프트) */
  driftKeys: string[];
  driftCheckedAt: Date | null;
}

export class MappingNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`배포 대상 매핑이 없습니다: ${id}`);
    this.name = 'MappingNotFoundError';
  }
}

export class ResourceAlreadyMappedError extends Error {
  constructor(readonly resourceName: string) {
    super(`이미 다른 매핑이 쓰는 리소스입니다: ${resourceName}`);
    this.name = 'ResourceAlreadyMappedError';
  }
}

export class SharedGroupNotDeployableError extends Error {
  constructor() {
    super(
      '공유 그룹은 배포 대상에 매핑하지 않습니다. 공유 값은 참조하는 프로젝트의 매핑으로 반영됩니다',
    );
    this.name = 'SharedGroupNotDeployableError';
  }
}

const MAPPING_INCLUDE = {
  project: { select: { name: true } },
  connection: { select: { id: true, name: true, type: true } },
  runs: { orderBy: { startedAt: 'desc' }, take: 1 },
} as const;

const splitList = (value: string | null) => (value ?? '').split(',').filter(Boolean);
const joinList = (values: string[]) =>
  values
    .map((value) => value.trim())
    .filter(Boolean)
    .join(',');

/** (프로젝트, 환경) → 배포 대상 리소스 매핑 (PRD 8.1, 결정 53) */
export class MappingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly connections: ConnectionsService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(project: string): Promise<MappingView[]> {
    const rows = await this.prisma.targetMapping.findMany({
      where: { project: { name: project } },
      orderBy: [{ env: 'asc' }, { resourceName: 'asc' }],
      include: MAPPING_INCLUDE,
    });
    return rows.map(toView);
  }

  async get(id: string): Promise<MappingView> {
    const row = await this.prisma.targetMapping.findUnique({
      where: { id },
      include: MAPPING_INCLUDE,
    });
    if (!row) throw new MappingNotFoundError(id);
    return toView(row);
  }

  async create(project: string, input: MappingInput): Promise<MappingView> {
    if (project === SHARED_PROJECT_NAME) throw new SharedGroupNotDeployableError();
    const projectRow = await this.prisma.project.findUnique({ where: { name: project } });
    if (!projectRow) throw new ProjectNotFoundError(project);

    const { provider, connection } = await this.connections.open(input.connectionId);
    const resource = (await provider.listResources(connection)).find(
      (candidate) => candidate.id === input.resourceId,
    );
    if (!resource) throw new TargetNotFoundError(`리소스가 없습니다: ${input.resourceId}`);
    const fields = validated(provider, input);
    const now = this.now();
    try {
      const row = await this.prisma.targetMapping.create({
        data: {
          connectionId: input.connectionId,
          projectId: projectRow.id,
          env: input.env,
          resourceId: resource.id,
          resourceName: resource.name,
          ...fields,
          createdAt: now,
          updatedAt: now,
        },
        include: MAPPING_INCLUDE,
      });
      return toView(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ResourceAlreadyMappedError(resource.name);
      throw error;
    }
  }

  async update(id: string, input: MappingUpdate): Promise<MappingView> {
    const current = await this.get(id);
    const { provider } = await this.connections.open(current.connection.id);
    const fields = validated(provider, {
      env: input.env ?? current.env,
      syncMode: input.syncMode ?? current.syncMode,
      afterSync: input.afterSync ?? current.afterSync,
      unmanaged: input.unmanaged ?? current.unmanaged,
      include: input.include ?? current.include,
      exclude: input.exclude ?? current.exclude,
      options: input.options ?? current.options,
    });
    const row = await this.prisma.targetMapping.update({
      where: { id },
      data: { ...fields, ...(input.env ? { env: input.env } : {}), updatedAt: this.now() },
      include: MAPPING_INCLUDE,
    });
    return toView(row);
  }

  async remove(id: string): Promise<void> {
    const { count } = await this.prisma.targetMapping.deleteMany({ where: { id } });
    if (count === 0) throw new MappingNotFoundError(id);
  }
}

/** 제공자가 지원하지 않는 동작·키 삭제는 고를 수 없다. 제공자 전용 옵션은 제공자가 검증한다 */
function validated(
  provider: AnyProvider,
  input: Omit<MappingUpdate, 'env'> & { env?: EnvironmentName },
) {
  const afterSync = input.afterSync ?? 'auto';
  if (
    (afterSync === 'restart' || afterSync === 'redeploy') &&
    !provider.capabilities.actions.includes(afterSync)
  ) {
    throw new InvalidTargetConfigError(
      `${provider.displayName}은(는) ${afterSync}를 지원하지 않습니다`,
    );
  }
  const unmanaged = input.unmanaged ?? 'keep';
  if (unmanaged === 'delete' && !provider.capabilities.deleteKeys) {
    throw new InvalidTargetConfigError(`${provider.displayName}은(는) 키 삭제를 지원하지 않습니다`);
  }
  const options = provider.parseMappingOptions(input.options ?? {});
  return {
    syncMode: input.syncMode ?? 'auto',
    afterSync,
    unmanaged,
    include: joinList(input.include ?? []),
    exclude: joinList(input.exclude ?? []),
    options: JSON.stringify(options),
  };
}

type MappingRow = {
  id: string;
  env: EnvironmentName;
  resourceId: string;
  resourceName: string;
  syncMode: SyncMode;
  afterSync: AfterSync;
  unmanaged: UnmanagedKeys;
  include: string;
  exclude: string;
  options: string;
  lastSyncedVersion: number | null;
  lastSyncedSharedVersion: number | null;
  lastSyncedAt: Date | null;
  driftKeys: string | null;
  driftCheckedAt: Date | null;
  project: { name: string };
  connection: { id: string; name: string; type: string };
  runs: {
    status: 'succeeded' | 'skipped' | 'failed';
    trigger: 'publish' | 'manual';
    action: string | null;
    error: string | null;
    finishedAt: Date;
  }[];
};

function toView(row: MappingRow): MappingView {
  const run = row.runs[0];
  return {
    id: row.id,
    project: row.project.name,
    env: row.env,
    connection: row.connection,
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    syncMode: row.syncMode,
    afterSync: row.afterSync,
    unmanaged: row.unmanaged,
    include: splitList(row.include),
    exclude: splitList(row.exclude),
    options: JSON.parse(row.options) as Record<string, unknown>,
    lastSync:
      row.lastSyncedVersion !== null && row.lastSyncedAt
        ? {
            version: row.lastSyncedVersion,
            sharedVersion: row.lastSyncedSharedVersion ?? 0,
            at: row.lastSyncedAt,
          }
        : null,
    lastRun: run
      ? {
          status: run.status,
          trigger: run.trigger,
          action: run.action,
          error: run.error,
          at: run.finishedAt,
        }
      : null,
    driftKeys: splitList(row.driftKeys),
    driftCheckedAt: row.driftCheckedAt,
  };
}
