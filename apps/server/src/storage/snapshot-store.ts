import type { Envelope } from '../crypto/envelope.js';

/** 스냅샷의 주인: 프로젝트 하나, 또는 여러 프로젝트가 같이 쓰는 공유 그룹 */
export type SnapshotOwner =
  | { scope: 'project'; project: string; env: string }
  | { scope: 'shared'; env: string };

export type SnapshotRef = SnapshotOwner & { version: number };

export class SnapshotNotFoundError extends Error {
  constructor(readonly ref: SnapshotRef) {
    super(`스냅샷이 없습니다: ${snapshotContext(ref)}`);
    this.name = 'SnapshotNotFoundError';
  }
}

/** 암호화된 스냅샷 봉투를 보관하는 곳. 운영은 R2(S3 API), 테스트는 메모리 구현을 쓴다 */
export abstract class SnapshotStore {
  abstract put(ref: SnapshotRef, envelope: Envelope): Promise<void>;
  /** 없으면 SnapshotNotFoundError */
  abstract get(ref: SnapshotRef): Promise<Envelope>;
  /** 저장된 버전 번호를 오름차순으로 돌려준다 */
  abstract listVersions(owner: SnapshotOwner): Promise<number[]>;
  /** 없는 스냅샷을 지워도 오류가 아니다 */
  abstract delete(ref: SnapshotRef): Promise<void>;
}

/** 봉투를 묶는 논리 위치 (암호화 인증 데이터). 예: `projects/server/production/v13` */
export function snapshotContext(ref: SnapshotRef): string {
  return `${ownerPrefix(ref)}/v${ref.version}`;
}

/** R2 객체 키 (PRD 5.3). 예: `projects/server/production/v13.json.enc` */
export function snapshotObjectKey(ref: SnapshotRef): string {
  return `${snapshotContext(ref)}.json.enc`;
}

/** 한 주인의 스냅샷이 모여 있는 경로. 예: `projects/server/production` */
export function ownerPrefix(owner: SnapshotOwner): string {
  assertSafeSegment(owner.env);
  if (owner.scope === 'shared') return `shared/${owner.env}`;
  assertSafeSegment(owner.project);
  return `projects/${owner.project}/${owner.env}`;
}

/** 이름에 `/`, `..` 같은 글자가 섞여 다른 경로를 가리키지 못하게 막는다 */
function assertSafeSegment(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(`저장소 경로에 쓸 수 없는 이름입니다: ${JSON.stringify(name)}`);
  }
}
