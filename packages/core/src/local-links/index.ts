/**
 * 로컬 자동 받기 (M1.1, PRD 결정 60~63). 에이전트가 파일을 쓸지 정하는 규칙과
 * 서버·대시보드가 함께 쓰는 상태 이름.
 */

/**
 * 에이전트가 연결마다 보고하는 마지막 상태.
 * - ok: 썼거나 이미 최신
 * - no_config: 폴더나 senv.json이 없음
 * - project_mismatch: senv.json의 project가 연결과 다름
 * - not_ignored: 출력 파일이 git에서 무시되지 않음
 * - symlink: 출력 파일이 심볼릭 링크
 * - modified: 마지막으로 쓴 뒤(또는 senv가 만들지 않은) 파일이 있어 덮어쓰지 않음
 * - exposure: 공개 접두사에 secret이 있어 쓰지 않음
 * - error: 그 밖의 오류 (서버, 파일 쓰기)
 */
export const LOCAL_LINK_STATES = [
  'ok',
  'no_config',
  'project_mismatch',
  'not_ignored',
  'symlink',
  'modified',
  'exposure',
  'error',
] as const;
export type LocalLinkState = (typeof LOCAL_LINK_STATES)[number];

export function isLocalLinkState(value: string): value is LocalLinkState {
  return (LOCAL_LINK_STATES as readonly string[]).includes(value);
}

export interface VersionPair {
  version: number;
  sharedVersion: number;
}

export interface LocalWriteInput {
  /** 서버의 현재 local 버전과 공유 버전 */
  remote: VersionPair;
  /** 이 기기가 마지막으로 쓴 것. 내용 해시는 기기에만 둔다 */
  written: (VersionPair & { hash: string }) | null;
  /** 지금 파일. 없으면 null */
  file: { hash: string; senvHeader: boolean } | null;
  /** 대시보드에서 "덮어쓰기"를 눌렀다 */
  overwriteRequested: boolean;
}

export type LocalWriteDecision = { action: 'write' | 'skip' | 'modified' };

/** 파일을 쓸지 정한다. 직접 고친 파일은 덮어쓰기 요청이 없으면 건드리지 않는다 (결정 62) */
export function decideLocalWrite(input: LocalWriteInput): LocalWriteDecision {
  const { remote, written, file, overwriteRequested } = input;
  if (overwriteRequested) return { action: 'write' };
  if (file) {
    const editedSinceWrite = written !== null && file.hash !== written.hash;
    const notFromSenv = written === null && !file.senvHeader;
    if (editedSinceWrite || notFromSenv) return { action: 'modified' };
  }
  if (written === null || file === null) return { action: 'write' };
  const changed =
    remote.version !== written.version || remote.sharedVersion !== written.sharedVersion;
  return { action: changed ? 'write' : 'skip' };
}

/** 대시보드 표시용: 마지막으로 쓴 버전이 지금 버전과 같은지 */
export function localLinkSyncState(
  current: VersionPair,
  written: VersionPair | null,
): 'never' | 'synced' | 'behind' {
  if (!written) return 'never';
  return written.version === current.version && written.sharedVersion === current.sharedVersion
    ? 'synced'
    : 'behind';
}
