import { type Keyring, openEnvelope, sealEnvelope } from '../crypto/envelope.js';
import {
  type SnapshotOwner,
  type SnapshotRef,
  type SnapshotStore,
  snapshotContext,
} from '../storage/snapshot-store.js';

/** 게시 한 번에 만들어지는 환경 전체의 값과 메타데이터 */
export interface SnapshotContent {
  createdAt: string;
  createdBy: string;
  message: string;
  variables: Record<string, string>;
}

export interface Snapshot extends SnapshotContent {
  ref: SnapshotRef;
}

export class InvalidSnapshotVersionError extends Error {
  constructor(readonly version: number) {
    super(`스냅샷 버전은 1 이상의 정수여야 합니다: ${version}`);
    this.name = 'InvalidSnapshotVersionError';
  }
}

/**
 * 스냅샷을 봉인해 저장소에 넣고, 꺼내서 연다.
 * 버전 번호는 DB가 게시 트랜잭션에서 정하고, 이 서비스는 지정된 버전만 다룬다.
 */
export class SnapshotService {
  constructor(
    private readonly store: SnapshotStore,
    private readonly keyring: Keyring,
  ) {}

  async save(ref: SnapshotRef, content: SnapshotContent): Promise<void> {
    if (!Number.isInteger(ref.version) || ref.version < 1) {
      throw new InvalidSnapshotVersionError(ref.version);
    }
    // 평문 형식은 PRD 5.3
    const plaintext = JSON.stringify({
      ...(ref.scope === 'project' ? { project: ref.project } : { shared: true }),
      env: ref.env,
      version: ref.version,
      createdAt: content.createdAt,
      createdBy: content.createdBy,
      message: content.message,
      variables: content.variables,
    });
    await this.store.put(ref, sealEnvelope(plaintext, snapshotContext(ref), this.keyring));
  }

  async load(ref: SnapshotRef): Promise<Snapshot> {
    const envelope = await this.store.get(ref);
    const stored = JSON.parse(openEnvelope(envelope, snapshotContext(ref), this.keyring));
    return {
      ref,
      createdAt: stored.createdAt,
      createdBy: stored.createdBy,
      message: stored.message,
      variables: stored.variables,
    };
  }

  /** 저장소에 있는 가장 큰 버전 번호. 비상 복구에서 DB 없이 최신 스냅샷을 찾을 때 쓴다 */
  async latestVersion(owner: SnapshotOwner): Promise<number | undefined> {
    return (await this.store.listVersions(owner)).at(-1);
  }
}
