import { randomBytes } from 'node:crypto';
import { InvalidTargetConfigError, TargetNotFoundError } from '@senv/core';
import { MemoryTargetProvider } from '@senv/target-testkit';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Keyring } from '../crypto/envelope.js';
import { ProjectNotFoundError, ProjectsService } from '../projects/projects-service.js';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { ConnectionsService } from './connections-service.js';
import {
  MappingNotFoundError,
  MappingsService,
  ResourceAlreadyMappedError,
  SharedGroupNotDeployableError,
} from './mappings-service.js';
import { TargetRegistry } from './target-registry.js';

const prisma = createTestPrisma();
const keyring: Keyring = { currentKekId: 'kek-1', keks: new Map([['kek-1', randomBytes(32)]]) };
const NOW = new Date('2026-10-08T09:00:00.000Z');

let memory: MemoryTargetProvider;
let mappings: MappingsService;
let connectionId: string;

beforeEach(async () => {
  await resetDatabase(prisma);
  memory = new MemoryTargetProvider({
    resources: [
      { id: 'app-api', name: 'stream-api-prod' },
      { id: 'app-web', name: 'stream-web-prod' },
    ],
    capabilities: { actions: ['redeploy'] },
  });
  const registry = new TargetRegistry([memory]);
  const connections = new ConnectionsService(prisma, registry, keyring, () => NOW);
  mappings = new MappingsService(prisma, connections, () => NOW);
  const projects = new ProjectsService(prisma);
  await projects.create({ name: 'server' });
  await projects.ensureSharedProject();
  connectionId = (
    await connections.create(
      { name: 'main', type: 'memory', config: { token: 'test-token' } },
      'u1',
    )
  ).id;
});
afterAll(() => prisma.$disconnect());

const create = (overrides: Record<string, unknown> = {}) =>
  mappings.create('server', {
    connectionId,
    env: 'production',
    resourceId: 'app-api',
    ...overrides,
  });

describe('MappingsService', () => {
  it('리소스 이름을 제공자에서 받아 저장하고, 빠진 옵션은 기본값으로 채운다', async () => {
    const created = await create({ afterSync: 'redeploy' });
    expect(created).toEqual({
      id: expect.any(String),
      project: 'server',
      env: 'production',
      connection: { id: connectionId, name: 'main', type: 'memory' },
      resourceId: 'app-api',
      resourceName: 'stream-api-prod',
      syncMode: 'auto',
      afterSync: 'redeploy',
      unmanaged: 'keep',
      include: [],
      exclude: [],
      options: {},
      lastSync: null,
      lastRun: null,
      driftKeys: [],
      driftCheckedAt: null,
    });
    expect(await mappings.list('server')).toEqual([created]);
  });

  it('없는 리소스면 TargetNotFoundError, 이미 매핑한 리소스면 ResourceAlreadyMappedError다', async () => {
    await expect(create({ resourceId: 'missing' })).rejects.toThrow(TargetNotFoundError);
    await create();
    await expect(create({ env: 'development' })).rejects.toThrow(ResourceAlreadyMappedError);
  });

  it('제공자가 지원하지 않는 반영 후 동작이나 키 삭제는 고를 수 없다', async () => {
    await expect(create({ afterSync: 'restart' })).rejects.toThrow(InvalidTargetConfigError);
    const noDelete = new MemoryTargetProvider({
      resources: [{ id: 'app-x', name: 'x' }],
      capabilities: { deleteKeys: false },
    });
    const connections = new ConnectionsService(
      prisma,
      new TargetRegistry([noDelete]),
      keyring,
      () => NOW,
    );
    const other = new MappingsService(prisma, connections, () => NOW);
    const conn = await connections.create(
      { name: 'nodelete', type: 'memory', config: { token: 'test-token' } },
      'u1',
    );
    await expect(
      other.create('server', {
        connectionId: conn.id,
        env: 'local',
        resourceId: 'app-x',
        unmanaged: 'delete',
      }),
    ).rejects.toThrow(InvalidTargetConfigError);
  });

  it('공유 그룹은 매핑할 수 없다. 없는 프로젝트는 ProjectNotFoundError다', async () => {
    await expect(
      mappings.create('shared', { connectionId, env: 'production', resourceId: 'app-api' }),
    ).rejects.toThrow(SharedGroupNotDeployableError);
    await expect(
      mappings.create('ghost', { connectionId, env: 'production', resourceId: 'app-api' }),
    ).rejects.toThrow(ProjectNotFoundError);
  });

  it('옵션을 고치고, 지운다', async () => {
    const { id } = await create();
    const updated = await mappings.update(id, {
      syncMode: 'manual',
      include: ['VITE_*'],
      exclude: ['SENTRY_*'],
      unmanaged: 'delete',
    });
    expect(updated).toMatchObject({
      syncMode: 'manual',
      include: ['VITE_*'],
      exclude: ['SENTRY_*'],
      unmanaged: 'delete',
    });

    await mappings.remove(id);
    expect(await mappings.list('server')).toEqual([]);
    await expect(mappings.remove(id)).rejects.toThrow(MappingNotFoundError);
  });
});
