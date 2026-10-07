import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { EnvelopeDecryptionError, type Keyring, openEnvelope } from '../crypto/envelope.js';
import { InMemorySnapshotStore } from '../storage/in-memory-snapshot-store.js';
import {
  SnapshotNotFoundError,
  type SnapshotRef,
  snapshotContext,
} from '../storage/snapshot-store.js';
import {
  InvalidSnapshotVersionError,
  type SnapshotContent,
  SnapshotService,
} from './snapshot-service.js';

const keyring: Keyring = { currentKekId: 'kek-1', keks: new Map([['kek-1', randomBytes(32)]]) };

const prodV13: SnapshotRef = {
  scope: 'project',
  project: 'server',
  env: 'production',
  version: 13,
};

const content: SnapshotContent = {
  createdAt: '2026-10-07T09:00:00.000Z',
  createdBy: 'user_123',
  message: '결제 키 교체',
  variables: { DATABASE_URL: 'mysql://db/app', PAYMENT_SECRET_KEY: 'sk_live_abc' },
};

describe('SnapshotService', () => {
  let store: InMemorySnapshotStore;
  let service: SnapshotService;

  beforeEach(() => {
    store = new InMemorySnapshotStore();
    service = new SnapshotService(store, keyring);
  });

  it('저장한 스냅샷을 같은 위치에서 그대로 읽는다', async () => {
    await service.save(prodV13, content);
    expect(await service.load(prodV13)).toEqual({ ref: prodV13, ...content });
  });

  it('공유 그룹 스냅샷도 저장하고 읽는다', async () => {
    const shared: SnapshotRef = { scope: 'shared', env: 'production', version: 1 };
    await service.save(shared, { ...content, variables: { API_HOST: 'api.stream.dev' } });
    expect((await service.load(shared)).variables).toEqual({ API_HOST: 'api.stream.dev' });
  });

  it('저장소에는 평문이 남지 않는다', async () => {
    await service.save(prodV13, content);
    const stored = JSON.stringify(await store.get(prodV13));
    expect(stored).not.toContain('sk_live_abc');
    expect(stored).not.toContain('결제 키 교체');
  });

  it('봉투 안의 평문은 PRD 5.3 형식이다', async () => {
    await service.save(prodV13, content);
    const plaintext = openEnvelope(await store.get(prodV13), snapshotContext(prodV13), keyring);
    expect(JSON.parse(plaintext)).toEqual({
      project: 'server',
      env: 'production',
      version: 13,
      createdAt: content.createdAt,
      createdBy: content.createdBy,
      message: content.message,
      variables: content.variables,
    });
  });

  it('다른 위치로 옮겨 놓은 봉투는 읽지 못한다', async () => {
    await service.save(prodV13, content);
    const devV13: SnapshotRef = { ...prodV13, env: 'development' };
    await store.put(devV13, await store.get(prodV13));
    await expect(service.load(devV13)).rejects.toThrow(EnvelopeDecryptionError);
  });

  it('없는 버전을 읽으면 SnapshotNotFoundError다', async () => {
    await expect(service.load(prodV13)).rejects.toThrow(SnapshotNotFoundError);
  });

  it('지운 스냅샷은 더는 읽을 수 없고, 없는 스냅샷을 지워도 오류가 아니다', async () => {
    await service.save(prodV13, content);
    await service.remove(prodV13);
    await expect(service.load(prodV13)).rejects.toThrow(SnapshotNotFoundError);
    await expect(service.remove(prodV13)).resolves.toBeUndefined();
  });

  it.each([0, -1, 1.5])('버전 %s 로는 저장할 수 없다', async (version) => {
    await expect(service.save({ ...prodV13, version }, content)).rejects.toThrow(
      InvalidSnapshotVersionError,
    );
  });

  describe('latestVersion', () => {
    const owner = { scope: 'project', project: 'server', env: 'production' } as const;

    it('저장된 버전이 없으면 undefined다', async () => {
      expect(await service.latestVersion(owner)).toBeUndefined();
    });

    it('가장 큰 버전 번호를 돌려준다 (문자열 순이 아니라 숫자 순)', async () => {
      for (const version of [2, 10, 9]) await service.save({ ...owner, version }, content);
      await service.save({ ...owner, env: 'staging', version: 99 }, content);
      expect(await service.latestVersion(owner)).toBe(10);
    });
  });
});
