import { describe, expect, it } from 'vitest';
import {
  decideLocalWrite,
  isLocalLinkState,
  isValidLocalPath,
  LOCAL_LINK_STATES,
  type LocalWriteInput,
  localLinkSyncState,
} from './index';

const base: LocalWriteInput = {
  remote: { version: 13, sharedVersion: 2 },
  written: { version: 12, sharedVersion: 2, hash: 'h12' },
  file: { hash: 'h12', senvHeader: true },
  overwriteRequested: false,
};

describe('decideLocalWrite', () => {
  it('서버 버전(또는 공유 버전)이 마지막으로 쓴 것과 다르면 쓴다', () => {
    expect(decideLocalWrite(base)).toEqual({ action: 'write' });
    expect(decideLocalWrite({ ...base, remote: { version: 12, sharedVersion: 3 } })).toEqual({
      action: 'write',
    });
  });

  it('같은 버전이고 파일도 그대로면 쓰지 않는다', () => {
    expect(decideLocalWrite({ ...base, remote: { version: 12, sharedVersion: 2 } })).toEqual({
      action: 'skip',
    });
  });

  it('마지막으로 쓴 뒤 파일이 고쳐졌으면 덮어쓰지 않는다 (결정 62)', () => {
    expect(decideLocalWrite({ ...base, file: { hash: 'edited', senvHeader: true } })).toEqual({
      action: 'modified',
    });
  });

  it('덮어쓰기 요청이 있으면 고친 파일도, 같은 버전도 쓴다', () => {
    const edited = {
      ...base,
      file: { hash: 'edited', senvHeader: false },
      overwriteRequested: true,
    };
    expect(decideLocalWrite(edited)).toEqual({ action: 'write' });
    expect(decideLocalWrite({ ...edited, remote: { version: 12, sharedVersion: 2 } })).toEqual({
      action: 'write',
    });
  });

  it('파일이 지워졌으면 같은 버전이어도 다시 쓴다', () => {
    expect(
      decideLocalWrite({ ...base, remote: { version: 12, sharedVersion: 2 }, file: null }),
    ).toEqual({ action: 'write' });
  });

  it('처음 쓰는 연결: 파일이 없거나 senv pull로 받은 파일이면 쓴다', () => {
    const first = { ...base, written: null };
    expect(decideLocalWrite({ ...first, file: null })).toEqual({ action: 'write' });
    expect(decideLocalWrite({ ...first, file: { hash: 'x', senvHeader: true } })).toEqual({
      action: 'write',
    });
  });

  it('처음 쓰는 연결인데 senv가 만들지 않은 파일이 있으면 덮어쓰지 않는다', () => {
    expect(
      decideLocalWrite({ ...base, written: null, file: { hash: 'x', senvHeader: false } }),
    ).toEqual({ action: 'modified' });
  });
});

describe('localLinkSyncState', () => {
  const current = { version: 13, sharedVersion: 2 };

  it('한 번도 쓰지 않았으면 never, 같으면 synced, 다르면 behind', () => {
    expect(localLinkSyncState(current, null)).toBe('never');
    expect(localLinkSyncState(current, { version: 13, sharedVersion: 2 })).toBe('synced');
    expect(localLinkSyncState(current, { version: 12, sharedVersion: 2 })).toBe('behind');
    expect(localLinkSyncState(current, { version: 13, sharedVersion: 1 })).toBe('behind');
  });
});

describe('LOCAL_LINK_STATES', () => {
  it('에이전트가 보고하는 상태 이름만 받는다', () => {
    expect(LOCAL_LINK_STATES).toContain('ok');
    expect(LOCAL_LINK_STATES).toContain('modified');
    expect(isLocalLinkState('not_ignored')).toBe(true);
    expect(isLocalLinkState('rm -rf')).toBe(false);
  });
});

describe('isValidLocalPath', () => {
  it.each(['/Users/me/work/web', '/home/dev/stream/apps/api', 'C:\\work\\web', 'D:/work/web'])(
    '절대 경로 %s',
    (path) => {
      expect(isValidLocalPath(path)).toBe(true);
    },
  );

  it.each([
    ['빈 값', ''],
    ['상대 경로', 'work/web'],
    ['~ 경로 (에이전트가 풀지 않는다)', '~/work/web'],
    ['.. 포함', '/Users/me/../other'],
    ['제어 문자', '/Users/me/web\u0000'],
    ['앞뒤 공백', ' /Users/me/web'],
    ['512자 초과', `/${'a'.repeat(512)}`],
  ])('%s → 거부', (_label, path) => {
    expect(isValidLocalPath(path)).toBe(false);
  });
});
