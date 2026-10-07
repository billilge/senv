// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 쓴다
import { randomBytes } from 'node:crypto';
import { TargetUnavailableError } from '@senv/core';
import { MemoryTargetProvider } from '@senv/target-testkit';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Keyring } from '../crypto/envelope.js';
import { DeliveryService } from '../delivery/delivery-service.js';
import { KeySchemaService } from '../key-schemas/key-schema-service.js';
import { ProjectsService } from '../projects/projects-service.js';
import { PublishService } from '../publishing/publish-service.js';
import { SnapshotService } from '../snapshots/snapshot-service.js';
import { InMemorySnapshotStore } from '../storage/in-memory-snapshot-store.js';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { ConnectionsService } from './connections-service.js';
import { MappingsService } from './mappings-service.js';
import { SyncService } from './sync-service.js';
import { TargetRegistry } from './target-registry.js';

const prisma = createTestPrisma();
const keyring: Keyring = { currentKekId: 'kek-1', keks: new Map([['kek-1', randomBytes(32)]]) };
const NOW = new Date('2026-10-08T09:00:00.000Z');

let memory: MemoryTargetProvider;
let publishing: PublishService;
let schemas: KeySchemaService;
let mappings: MappingsService;
let sync: SyncService;
let connectionId: string;

async function setup(capabilities = {}) {
  await resetDatabase(prisma);
  memory = new MemoryTargetProvider({
    resources: [{ id: 'app-api', name: 'stream-api' }],
    capabilities,
  });
  const registry = new TargetRegistry([memory]);
  const connections = new ConnectionsService(prisma, registry, keyring, () => NOW);
  publishing = new PublishService(
    prisma,
    new SnapshotService(new InMemorySnapshotStore(), keyring),
    () => NOW,
  );
  schemas = new KeySchemaService(prisma, () => NOW);
  mappings = new MappingsService(prisma, connections, () => NOW);
  sync = new SyncService(
    prisma,
    connections,
    new DeliveryService(publishing, schemas),
    schemas,
    publishing,
    keyring,
    () => NOW,
  );
  const projects = new ProjectsService(prisma);
  await projects.create({ name: 'server' });
  await projects.ensureSharedProject();
  connectionId = (
    await connections.create(
      { name: 'main', type: 'memory', config: { token: 'test-token' } },
      'u1',
    )
  ).id;
}

beforeEach(() => setup());
afterAll(() => prisma.$disconnect());

let versions: Record<string, number> = {};
async function publish(project: string, set: Record<string, string>, remove: string[] = []) {
  const base = versions[project] ?? 0;
  const result = await publishing.publish({
    project,
    env: 'production',
    baseVersion: base,
    changes: { set, ...(remove.length ? { remove } : {}) },
    actor: 'u1',
  });
  versions[project] = result.version;
  return result;
}
beforeEach(() => {
  versions = {};
});

const map = (overrides: Record<string, unknown> = {}) =>
  mappings.create('server', {
    connectionId,
    env: 'production',
    resourceId: 'app-api',
    ...overrides,
  });

describe('SyncService.sync', () => {
  it('원격에 값을 반영하고 재시작한 뒤 기록을 남긴다 (값은 남기지 않는다)', async () => {
    await publish('server', { A: '1', B: 'secret-b' });
    const { id } = await map();

    const run = await sync.sync(id, { trigger: 'manual', actor: 'u1' });

    expect(run).toMatchObject({
      status: 'succeeded',
      changedKeys: ['A', 'B'],
      action: 'restart',
      version: 1,
    });
    expect(memory.variablesOf('app-api')).toEqual({ A: '1', B: 'secret-b' });
    expect(memory.actions).toEqual([{ resourceId: 'app-api', action: 'restart' }]);
    const view = await mappings.get(id);
    expect(view.lastSync).toEqual({ version: 1, sharedVersion: 0, at: NOW });
    expect(view.lastRun).toMatchObject({
      status: 'succeeded',
      trigger: 'manual',
      action: 'restart',
    });
    const row = await prisma.syncRun.findFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain('secret-b');
  });

  it('빌드 시점 키가 바뀌면 재배포하고 원격에도 빌드 시점으로 표시한다', async () => {
    await schemas.put('server', 'VITE_API_URL', { buildTime: true }, 'u1');
    await publish('server', { VITE_API_URL: 'https://api' });
    const { id } = await map();

    expect(await sync.sync(id, { trigger: 'publish' })).toMatchObject({ action: 'redeploy' });
    expect(memory.buildTimeOf('app-api', 'VITE_API_URL')).toBe(true);
  });

  it('바뀐 것이 없으면 아무것도 하지 않고 skipped로 남긴다', async () => {
    await publish('server', { A: '1' });
    const { id } = await map();
    await sync.sync(id, { trigger: 'manual' });

    expect(await sync.sync(id, { trigger: 'manual' })).toMatchObject({
      status: 'skipped',
      changedKeys: [],
      action: null,
    });
    expect(memory.actions).toHaveLength(1);
  });

  it('공유 참조는 실제 값으로 풀어서 넣는다', async () => {
    await publish('shared', { API_HOST: 'api.stream.dev' });
    await publish('server', { API_URL: 'https://${shared.API_HOST}' });
    const { id } = await map();
    await sync.sync(id, { trigger: 'manual' });
    expect(memory.variablesOf('app-api')).toEqual({ API_URL: 'https://api.stream.dev' });
    expect((await mappings.get(id)).lastSync).toMatchObject({ version: 1, sharedVersion: 1 });
  });

  it('키 필터 밖의 키는 건드리지 않고, 관리 밖 키 삭제 옵션이면 지운다', async () => {
    memory.seed('app-api', { MANUAL: 'm', SENTRY_DSN: 'kept' });
    await publish('server', { A: '1', SENTRY_DSN: 'new' });
    const { id } = await map({ exclude: ['SENTRY_*'], unmanaged: 'delete' });

    expect(await sync.sync(id, { trigger: 'manual' })).toMatchObject({
      changedKeys: ['A', 'MANUAL'],
    });
    expect(memory.variablesOf('app-api')).toEqual({ SENTRY_DSN: 'kept', A: '1' });
  });

  it('제공자가 실패하면 failed로 남기고 오류를 다시 던진다', async () => {
    await publish('server', { A: '1' });
    const { id } = await map();
    memory.failNext(new TargetUnavailableError('Coolify 오류 (502)'));

    await expect(sync.sync(id, { trigger: 'publish', attempt: 2 })).rejects.toThrow(
      TargetUnavailableError,
    );
    expect(await prisma.syncRun.findFirstOrThrow()).toMatchObject({
      status: 'failed',
      attempt: 2,
      error: 'Coolify 오류 (502)',
    });
  });
});

describe('SyncService.plan', () => {
  it('반영하지 않고 바뀔 키와 반영 후 동작만 보여준다', async () => {
    memory.seed('app-api', { SAME: 's', OLD: 'x' });
    await publish('server', { SAME: 's', NEW: 'n' });
    const { id } = await map({ unmanaged: 'delete' });

    expect(await sync.plan(id)).toEqual({
      version: 1,
      sharedVersion: 0,
      add: ['NEW'],
      change: [],
      remove: ['OLD'],
      unchanged: 1,
      action: 'restart',
    });
    expect(memory.variablesOf('app-api')).toEqual({ SAME: 's', OLD: 'x' });
  });
});

describe('값을 읽을 수 없는 제공자', () => {
  beforeEach(() => setup({ readValues: false }));

  it('지난 동기화 해시와 견줘 바뀐 키만 보낸다', async () => {
    await publish('server', { A: '1', B: '2' });
    const { id } = await map();
    await sync.sync(id, { trigger: 'manual' });
    expect(await sync.sync(id, { trigger: 'manual' })).toMatchObject({ status: 'skipped' });

    await publish('server', { B: '3' });
    expect(await sync.sync(id, { trigger: 'manual' })).toMatchObject({ changedKeys: ['B'] });
  });
});

describe('SyncService.importRemote', () => {
  it('원격 값을 새 버전으로 게시하고, 스키마에 없는 키는 secret·필수로 등록한다', async () => {
    memory.seed('app-api', { A: '1' });
    memory.seed('app-api', { VITE_X: 'x' }, true);
    const { id } = await map();

    expect(await sync.importRemote(id, 'u1')).toEqual({ version: 1, keys: ['A', 'VITE_X'] });
    expect((await publishing.getCurrent('server', 'production')).variables).toEqual({
      A: '1',
      VITE_X: 'x',
    });
    expect((await schemas.get('server')).keys).toEqual([
      expect.objectContaining({ key: 'A', visibility: 'secret', required: true, buildTime: false }),
      expect.objectContaining({
        key: 'VITE_X',
        visibility: 'secret',
        required: true,
        buildTime: true,
      }),
    ]);
  });
});

describe('SyncService.checkDrift', () => {
  it('마지막 동기화 이후 인프라에서 바뀐 키를 표시하고, 다시 동기화하면 지운다', async () => {
    await publish('server', { A: '1', B: '2' });
    const { id } = await map();
    await sync.sync(id, { trigger: 'manual' });
    memory.seed('app-api', { A: 'changed-in-coolify' });

    expect(await sync.checkDrift(id)).toEqual(['A']);
    expect(await mappings.get(id)).toMatchObject({ driftKeys: ['A'], driftCheckedAt: NOW });

    await sync.sync(id, { trigger: 'manual' });
    expect((await mappings.get(id)).driftKeys).toEqual([]);
  });

  it('값 해시는 값을 그대로 해시하지 않는다 (짧은 값을 해시로 알아내지 못하게)', async () => {
    await publish('server', { DEBUG: 'true' });
    const { id } = await map();
    await sync.sync(id, { trigger: 'manual' });
    const row = await prisma.targetMapping.findFirstOrThrow();
    const { createHash } = await import('node:crypto');
    expect(row.lastSyncedHashes).not.toContain(createHash('sha256').update('true').digest('hex'));
  });
});
