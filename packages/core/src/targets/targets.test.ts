import { describe, expect, it } from 'vitest';
import {
  computeSyncPlan,
  type DesiredVariable,
  decideAction,
  matchesKeyFilter,
  type SyncOptions,
  type TargetCapabilities,
} from './index';

const ALL: TargetCapabilities = {
  readValues: true,
  deleteKeys: true,
  actions: ['restart', 'redeploy'],
  buildTimeFlag: true,
};
const KEEP: SyncOptions = { unmanaged: 'keep', include: [], exclude: [] };

const want = (key: string, value: string, buildTime = false): DesiredVariable => ({
  key,
  value,
  buildTime,
  multiline: value.includes('\n'),
});

describe('matchesKeyFilter', () => {
  it('포함 패턴이 없으면 모두 포함하고, 제외 패턴(*)에 걸리면 뺀다', () => {
    expect(matchesKeyFilter('API_URL', [], [])).toBe(true);
    expect(matchesKeyFilter('SENTRY_DSN', [], ['SENTRY_*'])).toBe(false);
    expect(matchesKeyFilter('API_URL', ['VITE_*'], [])).toBe(false);
    expect(matchesKeyFilter('VITE_API_URL', ['VITE_*'], ['*_URL'])).toBe(false);
    expect(matchesKeyFilter('VITE_MODE', ['VITE_*'], ['*_URL'])).toBe(true);
  });
});

describe('computeSyncPlan', () => {
  it('원격에 없는 키는 추가, 값이 다른 키는 변경, 같은 키는 변경 없음이다', () => {
    const plan = computeSyncPlan(
      [want('NEW', '1'), want('CHANGED', 'b'), want('SAME', 's')],
      [
        { key: 'CHANGED', value: 'a', buildTime: false },
        { key: 'SAME', value: 's', buildTime: false },
      ],
      KEEP,
      ALL,
    );
    expect(plan).toEqual({
      add: [want('NEW', '1')],
      change: [want('CHANGED', 'b')],
      remove: [],
      unchanged: ['SAME'],
    });
  });

  it('빌드 시점 표시만 달라도 변경이다 (제공자가 표시를 지원할 때)', () => {
    const remote = [{ key: 'A', value: '1', buildTime: false }];
    expect(computeSyncPlan([want('A', '1', true)], remote, KEEP, ALL).change).toHaveLength(1);
    expect(
      computeSyncPlan([want('A', '1', true)], remote, KEEP, { ...ALL, buildTimeFlag: false })
        .change,
    ).toEqual([]);
  });

  it('관리 밖 키는 기본으로 두고, 삭제 옵션이면 지운다 (제공자가 지울 수 있을 때만)', () => {
    const remote = [{ key: 'OLD', value: 'x', buildTime: false }];
    expect(computeSyncPlan([], remote, KEEP, ALL).remove).toEqual([]);
    const remove: SyncOptions = { ...KEEP, unmanaged: 'delete' };
    expect(computeSyncPlan([], remote, remove, ALL).remove).toEqual(['OLD']);
    expect(computeSyncPlan([], remote, remove, { ...ALL, deleteKeys: false }).remove).toEqual([]);
  });

  it('키 필터 밖의 키는 보내지도 지우지도 않는다', () => {
    const plan = computeSyncPlan(
      [want('API_URL', 'a'), want('SENTRY_DSN', 's')],
      [{ key: 'SENTRY_OLD', value: 'x', buildTime: false }],
      { unmanaged: 'delete', include: [], exclude: ['SENTRY_*'] },
      ALL,
    );
    expect(plan).toEqual({ add: [want('API_URL', 'a')], change: [], remove: [], unchanged: [] });
  });

  it('원격 값을 읽을 수 없으면(값이 null) 지난 동기화 해시가 같은 키만 변경 없음으로 본다', () => {
    const plan = computeSyncPlan(
      [want('A', '1'), want('B', '2')],
      [
        { key: 'A', value: null, buildTime: false, unchanged: true },
        { key: 'B', value: null, buildTime: false, unchanged: false },
      ],
      KEEP,
      { ...ALL, readValues: false },
    );
    expect(plan).toEqual({ add: [], change: [want('B', '2')], remove: [], unchanged: ['A'] });
  });
});

describe('decideAction', () => {
  const plan = (overrides: Partial<ReturnType<typeof computeSyncPlan>> = {}) => ({
    add: [],
    change: [],
    remove: [],
    unchanged: [],
    ...overrides,
  });

  it('바뀐 것이 없으면 아무것도 하지 않는다', () => {
    expect(decideAction(plan(), 'auto', ALL)).toBeNull();
    expect(decideAction(plan(), 'redeploy', ALL)).toBeNull();
  });

  it('자동이면 빌드 시점 키가 바뀔 때 재배포, 아니면 재시작이다', () => {
    expect(decideAction(plan({ change: [want('A', '1', true)] }), 'auto', ALL)).toBe('redeploy');
    expect(decideAction(plan({ add: [want('A', '1')] }), 'auto', ALL)).toBe('restart');
    expect(decideAction(plan({ remove: ['A'] }), 'auto', ALL)).toBe('restart');
  });

  it('자동인데 제공자가 재시작을 못 하면 재배포, 둘 다 못 하면 아무것도 하지 않는다', () => {
    const redeployOnly = { ...ALL, actions: ['redeploy' as const] };
    expect(decideAction(plan({ add: [want('A', '1')] }), 'auto', redeployOnly)).toBe('redeploy');
    expect(
      decideAction(plan({ add: [want('A', '1')] }), 'auto', { ...ALL, actions: [] }),
    ).toBeNull();
  });

  it('직접 고르면 그 동작이다. 없음이면 아무것도 하지 않는다', () => {
    expect(decideAction(plan({ add: [want('A', '1')] }), 'redeploy', ALL)).toBe('redeploy');
    expect(decideAction(plan({ add: [want('A', '1', true)] }), 'restart', ALL)).toBe('restart');
    expect(decideAction(plan({ add: [want('A', '1')] }), 'none', ALL)).toBeNull();
  });
});
