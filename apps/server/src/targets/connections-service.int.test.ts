import { randomBytes } from 'node:crypto';
import { InvalidTargetConfigError, TargetAuthError } from '@senv/core';
import { MemoryTargetProvider } from '@senv/target-testkit';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Keyring } from '../crypto/envelope.js';
import { ProjectsService } from '../projects/projects-service.js';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import {
  ConnectionInUseError,
  ConnectionNameTakenError,
  ConnectionNotFoundError,
  ConnectionsService,
  UnknownProviderError,
} from './connections-service.js';
import { TargetRegistry } from './target-registry.js';

const prisma = createTestPrisma();
const keyring: Keyring = { currentKekId: 'kek-1', keks: new Map([['kek-1', randomBytes(32)]]) };
const NOW = new Date('2026-10-08T09:00:00.000Z');

let memory: MemoryTargetProvider;
let connections: ConnectionsService;

beforeEach(async () => {
  await resetDatabase(prisma);
  memory = new MemoryTargetProvider({ resources: [{ id: 'app-1', name: 'stream-api' }] });
  connections = new ConnectionsService(prisma, new TargetRegistry([memory]), keyring, () => NOW);
});
afterAll(() => prisma.$disconnect());

const create = (name = 'main', config: unknown = { token: 'test-token' }) =>
  connections.create({ name, type: 'memory', config }, 'u-admin');

describe('ConnectionsService', () => {
  it('연결을 확인한 뒤 저장하고, 비밀 필드는 보여주지 않는다', async () => {
    const created = await create();
    expect(created).toEqual({
      id: expect.any(String),
      name: 'main',
      type: 'memory',
      config: {},
      mappingCount: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await connections.list()).toEqual([created]);
  });

  it('설정은 암호화해 저장한다 (DB에 토큰 원문이 없다)', async () => {
    await create();
    const row = await prisma.targetConnection.findFirstOrThrow();
    expect(row.config).not.toContain('test-token');
    const { provider, connection } = await connections.open(row.id);
    expect(provider).toBe(memory);
    expect(connection).toEqual({ token: 'test-token' });
  });

  it('설정이 틀리거나 자격 증명이 거부되면 저장하지 않는다', async () => {
    await expect(create('bad', {})).rejects.toThrow(InvalidTargetConfigError);
    await expect(create('wrong', { token: 'nope' })).rejects.toThrow(TargetAuthError);
    await expect(
      connections.create({ name: 'x', type: 'aws', config: {} }, 'u-admin'),
    ).rejects.toThrow(UnknownProviderError);
    expect(await connections.list()).toEqual([]);
  });

  it('이름이 겹치면 ConnectionNameTakenError다', async () => {
    await create('main');
    await expect(create('main')).rejects.toThrow(ConnectionNameTakenError);
  });

  it('고칠 때 비밀 필드를 비우면 기존 값을 그대로 쓴다', async () => {
    const { id } = await create();
    const renamed = await connections.update(id, { name: 'coolify-main', config: { token: '' } });
    expect(renamed.name).toBe('coolify-main');
    expect((await connections.open(id)).connection).toEqual({ token: 'test-token' });
    await expect(connections.update(id, { config: { token: 'nope' } })).rejects.toThrow(
      TargetAuthError,
    );
  });

  it('리소스 목록을 제공자에서 받아 온다', async () => {
    const { id } = await create();
    expect(await connections.resources(id)).toEqual([{ id: 'app-1', name: 'stream-api' }]);
  });

  it('매핑이 있는 연결은 지울 수 없다. 없는 연결은 ConnectionNotFoundError다', async () => {
    const { id } = await create();
    const project = await new ProjectsService(prisma).create({ name: 'server' });
    const projectRow = await prisma.project.findUniqueOrThrow({ where: { name: project.name } });
    await prisma.targetMapping.create({
      data: {
        connectionId: id,
        projectId: projectRow.id,
        env: 'production',
        resourceId: 'app-1',
        resourceName: 'stream-api',
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    expect((await connections.list())[0]?.mappingCount).toBe(1);
    await expect(connections.remove(id)).rejects.toThrow(ConnectionInUseError);

    await prisma.targetMapping.deleteMany();
    await connections.remove(id);
    await expect(connections.open(id)).rejects.toThrow(ConnectionNotFoundError);
  });
});
