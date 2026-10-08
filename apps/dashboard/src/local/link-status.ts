import { type LocalLinkState, localLinkSyncState } from '@senv/core';
import type { LocalLink } from './queries';

export const STATE_LABEL: Record<LocalLinkState, string> = {
  ok: '정상',
  no_config: '폴더나 senv.json이 없음',
  project_mismatch: 'senv.json의 프로젝트가 다름',
  not_ignored: '출력 파일이 git에서 무시되지 않음',
  symlink: '출력 파일이 심볼릭 링크',
  modified: '직접 고친 파일이라 덮어쓰지 않음',
  exposure: '공개 접두사에 secret이 있음',
  error: '오류',
};

/** 연결 목록에 쓰는 상태 문장 (승인 대기는 화면이 명령을 따로 보여준다) */
export function linkSummary(link: LocalLink): string {
  if (link.status === 'pending') return '이 PC에서 승인해야 씁니다';
  if (link.status === 'paused') return '일시정지';
  if (link.lastState && link.lastState.state !== 'ok') {
    return link.lastState.message ?? STATE_LABEL[link.lastState.state];
  }
  const written = link.lastWritten;
  switch (localLinkSyncState(link.current, written)) {
    case 'never':
      return '아직 쓰지 않음';
    case 'synced':
      return `v${written?.version} 반영됨`;
    case 'behind':
      return `v${written?.version} 반영됨, v${link.current.version} 반영 대기`;
  }
}

/** 프로젝트 화면 local 열에 붙이는 짧은 표시 */
export function matrixNote(link: LocalLink): string {
  if (link.status === 'pending') return '내 PC 승인 대기';
  if (link.status === 'paused') return '내 PC 일시정지';
  if (link.lastState && link.lastState.state !== 'ok') return '내 PC 확인 필요';
  const written = link.lastWritten;
  switch (localLinkSyncState(link.current, written)) {
    case 'never':
      return '내 PC 아직 안 씀';
    case 'synced':
      return `내 PC v${written?.version}`;
    case 'behind':
      return `내 PC v${written?.version}, v${link.current.version} 대기`;
  }
}
