import { randomBytes } from 'node:crypto';
import { MemoryTargetProvider } from '@senv/target-testkit';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Keyring } from '../crypto/envelope.js';
import { JobsService } from '../jobs/jobs-service.js';
import { ProjectsService } from '../projects/projects-service.js';
import { PublishService, PublishValidationError } from '../publishing/publish-service.js';
import { SnapshotService } from '../snapshots/snapshot-service.js';
import { InMemorySnapshotStore } from '../storage/in-memory-snapshot-store.js';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { ConnectionsService } from './connections-service.js';
import { MappingsService } from './mappings-service.js';
import { SYNC_JOB, SyncScheduler } from './sync-scheduler.js';
import { TargetRegistry } from './target-registry.js';

const prisma = createTestPrisma();
const keyring: Keyring = { currentKekId: 'kek-1', keks: new Map([['kek-1', randomBytes(32)]]) };
const NOW = new Date('2026-10-08T09:00:00.000Z');

let publishing: PublishService;
let ids: Record<string, string>;

beforeEach(async () => {
  await resetDatabase(prisma);
  const memory = new MemoryTargetProvider({
    resources: ['api-prod', 'web-prod', 'api-dev', 'api-manual'].map((id) => ({ id, name: id })),
  });
  const connections = new ConnectionsService(
    prisma,
    new TargetRegistry([memory]),
    keyring,
    () => NOW,
  );
  const mappings = new MappingsService(prisma, connections, () => NOW);
  publishing = new PublishService(
    prisma,
    new SnapshotService(new InMemorySnapshotStore(), keyring),
    () => NOW,
    new SyncScheduler(new JobsService(prisma, () => NOW)),
  );
  const projects = new ProjectsService(prisma);
  await projects.create({ name: 'server' });
  await projects.create({ name: 'web' });
  await projects.ensureSharedProject();
  const { id: connectionId } = await connections.create(
    { name: 'main', type: 'memory', config: { token: 'test-token' } },
    'u1',
  );
  const map = (
    project: string,
    env: 'production' | 'development',
    resourceId: string,
    syncMode: 'auto' | 'manual' = 'auto',
  ) => mappings.create(project, { connectionId, env, resourceId, syncMode }).then((m) => m.id);
  ids = {
    apiProd: await map('server', 'production', 'api-prod'),
    webProd: await map('web', 'production', 'web-prod'),
    apiDev: await map('server', 'development', 'api-dev'),
    apiManual: await map('server', 'production', 'api-manual', 'manual'),
  };
});
afterAll(() => prisma.$disconnect());

const queued = async () =>
  (await prisma.job.findMany({ where: { type: SYNC_JOB } }))
    .map((job) => JSON.parse(job.payload).mappingId)
    .sort();

const publish = (project: string, set: Record<string, string>) =>
  publishing.publish({ project, env: 'production', baseVersion: 0, changes: { set }, actor: 'u1' });

describe('게시하면 자동 매핑의 동기화 작업을 등록한다', () => {
  it('그 프로젝트·환경의 자동 매핑만 (수동 매핑과 다른 환경은 빼고)', async () => {
    await publish('server', { A: '1' });
    expect(await queued()).toEqual([ids.apiProd]);
  });

  it('공유 그룹을 게시하면 그 환경의 모든 자동 매핑', async () => {
    await publish('shared', { API_HOST: 'api' });
    expect(await queued()).toEqual([ids.apiProd, ids.webProd].sort());
  });

  it('게시가 실패하면 작업도 남지 않는다 (같은 트랜잭션)', async () => {
    await expect(publish('server', { 'bad-key': '1' })).rejects.toThrow(PublishValidationError);
    expect(await queued()).toEqual([]);
  });
});
