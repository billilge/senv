import type { Envelope } from '../crypto/envelope.js';
import {
  ownerPrefix,
  SnapshotNotFoundError,
  type SnapshotOwner,
  type SnapshotRef,
  SnapshotStore,
  snapshotObjectKey,
} from './snapshot-store.js';

/** 테스트와 로컬 개발용 메모리 저장소. R2와 같은 계약을 따른다 */
export class InMemorySnapshotStore extends SnapshotStore {
  private readonly objects = new Map<string, Envelope>();

  async put(ref: SnapshotRef, envelope: Envelope): Promise<void> {
    this.objects.set(snapshotObjectKey(ref), structuredClone(envelope));
  }

  async get(ref: SnapshotRef): Promise<Envelope> {
    const envelope = this.objects.get(snapshotObjectKey(ref));
    if (!envelope) throw new SnapshotNotFoundError(ref);
    return structuredClone(envelope);
  }

  async listVersions(owner: SnapshotOwner): Promise<number[]> {
    return versionsUnder(ownerPrefix(owner), this.objects.keys());
  }

  async delete(ref: SnapshotRef): Promise<void> {
    this.objects.delete(snapshotObjectKey(ref));
  }
}

/** `{prefix}/v{n}.json.enc` 형태의 키에서 버전 번호만 골라 오름차순으로 돌려준다 */
export function versionsUnder(prefix: string, keys: Iterable<string>): number[] {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}/v(\\d+)\\.json\\.enc$`);
  const versions: number[] = [];
  for (const key of keys) {
    const match = pattern.exec(key);
    if (match) versions.push(Number(match[1]));
  }
  return versions.sort((a, b) => a - b);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
