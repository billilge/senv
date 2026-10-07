import { createHash, createHmac } from 'node:crypto';
import {
  type AfterSync,
  computeSyncPlan,
  type DesiredVariable,
  decideAction,
  matchesKeyFilter,
  type RemoteVariable,
  type SyncOptions,
  type TargetAction,
} from '@senv/core';
import type { Keyring } from '../crypto/envelope.js';
import type { DeliveryService } from '../delivery/delivery-service.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { KeySchemaService } from '../key-schemas/key-schema-service.js';
import { NoChangesError, type PublishService } from '../publishing/publish-service.js';
import type { ConnectionsService } from './connections-service.js';
import { MappingNotFoundError } from './mappings-service.js';
import type { AnyProvider } from './target-registry.js';

export interface SyncPreview {
  version: number;
  sharedVersion: number;
  add: string[];
  change: string[];
  remove: string[];
  unchanged: number;
  action: TargetAction | null;
}

export interface SyncRunView {
  id: string;
  trigger: 'publish' | 'manual';
  status: 'succeeded' | 'skipped' | 'failed';
  version: number;
  sharedVersion: number;
  changedKeys: string[];
  action: TargetAction | null;
  providerRef: string | null;
  error: string | null;
  attempt: number;
  startedAt: Date;
  finishedAt: Date;
}

export class ImportNotSupportedError extends Error {
  constructor(readonly provider: string) {
    super(`${provider}은(는) 원격 값을 읽을 수 없어 가져오기를 지원하지 않습니다`);
    this.name = 'ImportNotSupportedError';
  }
}

/** 마지막으로 반영한 값의 키별 해시. 값 자체는 남기지 않는다 */
interface StoredHashes {
  kekId: string;
  hashes: Record<string, string>;
}

type MappingRow = NonNullable<Awaited<ReturnType<SyncService['loadMapping']>>>;

/**
 * 배포 대상 동기화 엔진 (PRD 8.2~8.4, 결정 53~55).
 * 제공자는 한 번 호출만 맡고, 기록·해시·드리프트는 여기서 한다.
 */
export class SyncService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly connections: ConnectionsService,
    private readonly delivery: DeliveryService,
    private readonly schemas: KeySchemaService,
    private readonly publishing: PublishService,
    private readonly keyring: Keyring,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 반영하지 않고 바뀔 키와 반영 후 동작을 계산한다 (diff 미리보기) */
  async plan(mappingId: string): Promise<SyncPreview> {
    const mapping = await this.requireMapping(mappingId);
    const { provider, connection } = await this.connections.open(mapping.connectionId);
    const prepared = await this.prepare(mapping, provider, connection);
    return {
      version: prepared.version,
      sharedVersion: prepared.sharedVersion,
      add: prepared.plan.add.map((variable) => variable.key),
      change: prepared.plan.change.map((variable) => variable.key),
      remove: prepared.plan.remove,
      unchanged: prepared.plan.unchanged.length,
      action: prepared.action,
    };
  }

  /** 계획을 반영하고 반영 후 동작을 실행한 뒤 기록한다. 실패하면 기록하고 오류를 다시 던진다 */
  async sync(
    mappingId: string,
    input: { trigger: 'publish' | 'manual'; actor?: string; attempt?: number },
  ): Promise<SyncRunView> {
    const startedAt = this.now();
    const mapping = await this.requireMapping(mappingId);
    const base = {
      mappingId,
      trigger: input.trigger,
      attempt: input.attempt ?? 1,
      actor: input.actor ?? null,
      startedAt,
    };
    let version = mapping.lastSyncedVersion ?? 0;
    let sharedVersion = mapping.lastSyncedSharedVersion ?? 0;

    try {
      const { provider, connection } = await this.connections.open(mapping.connectionId);
      const prepared = await this.prepare(mapping, provider, connection);
      version = prepared.version;
      sharedVersion = prepared.sharedVersion;
      const changedKeys = [
        ...prepared.plan.add.map((variable) => variable.key),
        ...prepared.plan.change.map((variable) => variable.key),
        ...prepared.plan.remove,
      ].sort();

      let providerRef: string | null = null;
      if (changedKeys.length > 0) {
        const options = provider.parseMappingOptions(JSON.parse(mapping.options));
        const applied = await provider.applyPlan(
          connection,
          mapping.resourceId,
          prepared.plan,
          options,
        );
        providerRef = applied.ref ?? null;
        if (prepared.action && provider.runAction) {
          const result = await provider.runAction(connection, mapping.resourceId, prepared.action);
          providerRef = result.ref ?? providerRef;
        }
      }

      const finishedAt = this.now();
      await this.prisma.targetMapping.update({
        where: { id: mappingId },
        data: {
          lastSyncedHashes: JSON.stringify(this.hashes(prepared.desired)),
          lastSyncedVersion: version,
          lastSyncedSharedVersion: sharedVersion,
          lastSyncedAt: finishedAt,
          driftKeys: null,
        },
      });
      return this.record({
        ...base,
        status: changedKeys.length > 0 ? 'succeeded' : 'skipped',
        version,
        sharedVersion,
        changedKeys,
        action: changedKeys.length > 0 ? prepared.action : null,
        providerRef,
        error: null,
        finishedAt,
      });
    } catch (error) {
      await this.record({
        ...base,
        status: 'failed',
        version,
        sharedVersion,
        changedKeys: [],
        action: null,
        providerRef: null,
        error: (error as Error).message.slice(0, 1000),
        finishedAt: this.now(),
      });
      throw error;
    }
  }

  /**
   * 원격 값을 그 환경의 새 버전으로 게시한다 (초기 가져오기·드리프트 처리, PRD 8.4).
   * 지금 값과 다른 키만 보내고, 스키마에 없는 키는 secret·필수로 등록한다.
   */
  async importRemote(
    mappingId: string,
    actor: string,
  ): Promise<{ version: number; keys: string[] }> {
    const mapping = await this.requireMapping(mappingId);
    const { provider, connection } = await this.connections.open(mapping.connectionId);
    if (!provider.capabilities.readValues) throw new ImportNotSupportedError(provider.displayName);

    const options = syncOptions(mapping);
    const remote = (await provider.readVariables(connection, mapping.resourceId)).filter(
      (variable): variable is RemoteVariable & { value: string } =>
        variable.value !== null && matchesKeyFilter(variable.key, options.include, options.exclude),
    );
    const current = await this.publishing.getCurrent(mapping.project.name, mapping.env);
    const set = Object.fromEntries(
      remote
        .filter((variable) => current.variables[variable.key] !== variable.value)
        .map((variable) => [variable.key, variable.value]),
    );
    if (Object.keys(set).length === 0) throw new NoChangesError();

    const result = await this.publishing.publish({
      project: mapping.project.name,
      env: mapping.env,
      baseVersion: current.version,
      changes: { set },
      message: `${mapping.resourceName}에서 가져옴`,
      actor,
    });
    const registered = new Set(
      (await this.schemas.get(mapping.project.name)).keys.map((entry) => entry.key),
    );
    for (const variable of remote) {
      if (registered.has(variable.key)) continue;
      await this.schemas.put(
        mapping.project.name,
        variable.key,
        { visibility: 'secret', required: true, buildTime: variable.buildTime },
        actor,
      );
    }
    return { version: result.version, keys: Object.keys(set).sort() };
  }

  /** 마지막 동기화 이후 인프라에서 직접 바뀐 키를 찾아 매핑에 표시한다 (PRD 8.3) */
  async checkDrift(mappingId: string): Promise<string[]> {
    const mapping = await this.requireMapping(mappingId);
    const { provider, connection } = await this.connections.open(mapping.connectionId);
    const stored = parseHashes(mapping.lastSyncedHashes);
    if (!provider.capabilities.readValues || !stored || !this.keyring.keks.has(stored.kekId))
      return [];

    const remote = new Map(
      (await provider.readVariables(connection, mapping.resourceId)).map((variable) => [
        variable.key,
        variable.value,
      ]),
    );
    const drift = Object.entries(stored.hashes)
      .filter(([key, hash]) => {
        const value = remote.get(key);
        return value === undefined || value === null || this.hash(value, stored.kekId) !== hash;
      })
      .map(([key]) => key)
      .sort();
    await this.prisma.targetMapping.update({
      where: { id: mappingId },
      data: { driftKeys: drift.length > 0 ? drift.join(',') : null, driftCheckedAt: this.now() },
    });
    return drift;
  }

  async runs(mappingId: string, limit = 20): Promise<SyncRunView[]> {
    await this.requireMapping(mappingId);
    const rows = await this.prisma.syncRun.findMany({
      where: { mappingId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return rows.map(toRunView);
  }

  private async prepare(mapping: MappingRow, provider: AnyProvider, connection: unknown) {
    const delivered = await this.delivery.resolve(mapping.project.name, mapping.env);
    const schema = await this.schemas.get(mapping.project.name);
    const buildTime = new Set(
      schema.keys.filter((entry) => entry.buildTime).map((entry) => entry.key),
    );
    const desired: DesiredVariable[] = Object.entries(delivered.variables).map(([key, value]) => ({
      key,
      value,
      buildTime: buildTime.has(key),
      multiline: value.includes('\n'),
    }));

    const stored = parseHashes(mapping.lastSyncedHashes);
    const desiredByKey = new Map(desired.map((variable) => [variable.key, variable.value]));
    const remote = (await provider.readVariables(connection, mapping.resourceId)).map(
      (variable) => {
        if (variable.value !== null || !stored) return variable;
        // 값을 읽을 수 없으면 지난번에 반영한 값의 해시와 견준다
        const value = desiredByKey.get(variable.key);
        return {
          ...variable,
          unchanged:
            value !== undefined && this.hash(value, stored.kekId) === stored.hashes[variable.key],
        };
      },
    );
    const options = syncOptions(mapping);
    const plan = computeSyncPlan(desired, remote, options, provider.capabilities);
    const action = decideAction(plan, mapping.afterSync as AfterSync, provider.capabilities);
    const managed = desired.filter((variable) =>
      matchesKeyFilter(variable.key, options.include, options.exclude),
    );
    return {
      plan,
      action,
      desired: managed,
      version: delivered.version,
      sharedVersion: delivered.sharedVersion,
    };
  }

  private async requireMapping(id: string) {
    const mapping = await this.loadMapping(id);
    if (!mapping) throw new MappingNotFoundError(id);
    return mapping;
  }

  private loadMapping(id: string) {
    return this.prisma.targetMapping.findUnique({
      where: { id },
      include: { project: { select: { name: true } } },
    });
  }

  /** KEK에서 파생한 키로 HMAC. 짧은 값(true, 포트)을 해시로 거꾸로 알아내지 못하게 한다 */
  private hash(value: string, kekId: string): string {
    const kek = this.keyring.keks.get(kekId);
    if (!kek) throw new Error(`KEK가 없습니다: ${kekId}`);
    const key = createHash('sha256').update('senv:sync-hash:').update(kek).digest();
    return createHmac('sha256', key).update(value).digest('hex');
  }

  private hashes(desired: DesiredVariable[]): StoredHashes {
    const kekId = this.keyring.currentKekId;
    return {
      kekId,
      hashes: Object.fromEntries(
        desired.map((variable) => [variable.key, this.hash(variable.value, kekId)]),
      ),
    };
  }

  private async record(run: Omit<SyncRunView, 'id'> & { mappingId: string; actor: string | null }) {
    const { changedKeys, ...rest } = run;
    const row = await this.prisma.syncRun.create({
      data: { ...rest, changedKeys: changedKeys.join(',') },
    });
    return toRunView(row);
  }
}

function syncOptions(mapping: MappingRow): SyncOptions {
  return {
    unmanaged: mapping.unmanaged,
    include: mapping.include.split(',').filter(Boolean),
    exclude: mapping.exclude.split(',').filter(Boolean),
  };
}

function parseHashes(value: string | null): StoredHashes | null {
  return value ? (JSON.parse(value) as StoredHashes) : null;
}

function toRunView(row: {
  id: string;
  trigger: 'publish' | 'manual';
  status: 'succeeded' | 'skipped' | 'failed';
  version: number;
  sharedVersion: number;
  changedKeys: string;
  action: string | null;
  providerRef: string | null;
  error: string | null;
  attempt: number;
  startedAt: Date;
  finishedAt: Date;
}): SyncRunView {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    version: row.version,
    sharedVersion: row.sharedVersion,
    changedKeys: row.changedKeys.split(',').filter(Boolean),
    action: row.action === 'restart' || row.action === 'redeploy' ? row.action : null,
    providerRef: row.providerRef,
    error: row.error,
    attempt: row.attempt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}
