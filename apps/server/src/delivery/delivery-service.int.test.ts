// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 쓴다
import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Keyring } from '../crypto/envelope.js';
import { KeySchemaService } from '../key-schemas/key-schema-service.js';
import { ProjectNotFoundError, ProjectsService } from '../projects/projects-service.js';
import { InvalidEnvironmentError, PublishService } from '../publishing/publish-service.js';
import { SnapshotService } from '../snapshots/snapshot-service.js';
import { InMemorySnapshotStore } from '../storage/in-memory-snapshot-store.js';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { forceCurrentVersion } from '../testing/versions.js';
import { BrokenReferenceError, DeliveryService } from './delivery-service.js';

const prisma = createTestPrisma();
const keyring: Keyring = { currentKekId: 'kek-1', keks: new Map([['kek-1', randomBytes(32)]]) };

let snapshots: SnapshotService;
let publishing: PublishService;
let delivery: DeliveryService;

beforeEach(async () => {
  await resetDatabase(prisma);
  snapshots = new SnapshotService(new InMemorySnapshotStore(), keyring);
  publishing = new PublishService(prisma, snapshots);
  delivery = new DeliveryService(publishing, new KeySchemaService(prisma));
  const projects = new ProjectsService(prisma);
  await projects.create({ name: 'web' });
  await projects.ensureSharedProject();
});
afterAll(() => prisma.$disconnect());

function publish(project: string, set: Record<string, string>, baseVersion = 0) {
  return publishing.publish({
    project,
    env: 'production',
    baseVersion,
    changes: { set },
    actor: 'user_1',
  });
}

describe('DeliveryService.resolve', () => {
  it('공유 참조를 실제 값으로 바꾸고, 프로젝트 버전과 공유 그룹 버전을 함께 돌려준다', async () => {
    await publish('shared', { API_HOST: 'api.stream.dev' });
    await publish('shared', { API_HOST: 'api2.stream.dev' }, 1);
    await publish('web', { VITE_API_URL: 'https://${shared.API_HOST}/v1', VITE_MODE: 'prod' });

    expect(await delivery.resolve('web', 'production')).toEqual({
      project: 'web',
      env: 'production',
      version: 1,
      sharedVersion: 2,
      variables: { VITE_API_URL: 'https://api2.stream.dev/v1', VITE_MODE: 'prod' },
      exposure: { exposedSecrets: [], unregistered: [] },
    });
  });

  it('공유 그룹을 게시한 적이 없으면 sharedVersion은 0이다', async () => {
    await publish('web', { VITE_MODE: 'prod' });
    expect(await delivery.resolve('web', 'production')).toMatchObject({
      version: 1,
      sharedVersion: 0,
      variables: { VITE_MODE: 'prod' },
    });
  });

  it('아직 게시한 적이 없으면 버전 0과 빈 값이다', async () => {
    expect(await delivery.resolve('web', 'local')).toEqual({
      project: 'web',
      env: 'local',
      version: 0,
      sharedVersion: 0,
      variables: {},
      exposure: { exposedSecrets: [], unregistered: [] },
    });
  });

  it('참조가 깨져 있으면 값을 돌려주지 않고 BrokenReferenceError다', async () => {
    await forceCurrentVersion(
      prisma,
      snapshots,
      { project: 'web', env: 'production', version: 1 },
      { VITE_API_URL: '${shared.GONE}', VITE_MODE: 'prod' },
    );

    const attempt = delivery.resolve('web', 'production');
    await expect(attempt).rejects.toThrow(BrokenReferenceError);
    await expect(attempt).rejects.toMatchObject({
      issues: [{ code: 'missing_reference', key: 'VITE_API_URL', reference: '${shared.GONE}' }],
    });
  });

  it('공유 프로젝트 자체를 조회하면 값을 그대로 돌려준다', async () => {
    await publish('shared', { API_HOST: 'api.stream.dev' });
    expect(await delivery.resolve('shared', 'production')).toEqual({
      project: 'shared',
      env: 'production',
      version: 1,
      sharedVersion: 1,
      variables: { API_HOST: 'api.stream.dev' },
      exposure: { exposedSecrets: [], unregistered: [] },
    });
  });

  it('없는 프로젝트면 ProjectNotFoundError, 고정 환경이 아니면 InvalidEnvironmentError다', async () => {
    await expect(delivery.resolve('ghost', 'local')).rejects.toThrow(ProjectNotFoundError);
    await expect(delivery.resolve('web', 'staging')).rejects.toThrow(InvalidEnvironmentError);
  });

  it('공개 접두사가 붙은 키가 secret이면 exposedSecrets, 스키마에 없으면 unregistered로 알린다', async () => {
    const schemas = new KeySchemaService(prisma);
    await schemas.setPublicPrefixes('web', ['VITE_']);
    await schemas.put('web', 'VITE_SECRET', { visibility: 'secret' }, 'u1');
    await schemas.put('web', 'VITE_PUBLIC', { visibility: 'public' }, 'u1');
    await publish('web', { VITE_SECRET: 's', VITE_PUBLIC: 'p', VITE_NEW: 'n', SERVER_ONLY: 'x' });

    expect((await delivery.resolve('web', 'production')).exposure).toEqual({
      exposedSecrets: ['VITE_SECRET'],
      unregistered: ['VITE_NEW'],
    });
  });
});
