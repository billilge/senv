import { describe, expect, it } from 'vitest';
import {
  applyChangeSet,
  ChangeSetConflictError,
  createChangeSet,
  diffVariables,
  hasChanges,
} from './index';

describe('diffVariables', () => {
  it('값이 모두 같으면 unchanged만 있다', () => {
    expect(diffVariables({ A: '1', B: '2' }, { A: '1', B: '2' })).toEqual({
      added: [],
      removed: [],
      changed: [],
      unchanged: ['A', 'B'],
    });
  });

  it('새로 생긴 키는 added, 사라진 키는 removed, 값이 바뀐 키는 changed다', () => {
    expect(
      diffVariables({ KEEP: 'x', OLD: '1', EDIT: 'a' }, { KEEP: 'x', NEW: '2', EDIT: 'b' }),
    ).toEqual({
      added: ['NEW'],
      removed: ['OLD'],
      changed: ['EDIT'],
      unchanged: ['KEEP'],
    });
  });

  it('빈 문자열도 값으로 본다', () => {
    expect(diffVariables({ A: 'x', B: '' }, { A: '', B: '', C: '' })).toEqual({
      added: ['C'],
      removed: [],
      changed: ['A'],
      unchanged: ['B'],
    });
  });

  it('각 목록은 키 이름 순이다', () => {
    const diff = diffVariables({ Z_OLD: '1', A_OLD: '1' }, { Y_NEW: '1', B_NEW: '1' });
    expect(diff.added).toEqual(['B_NEW', 'Y_NEW']);
    expect(diff.removed).toEqual(['A_OLD', 'Z_OLD']);
  });

  it('둘 다 비어 있으면 모든 목록이 비어 있다', () => {
    expect(diffVariables({}, {})).toEqual({ added: [], removed: [], changed: [], unchanged: [] });
  });
});

describe('hasChanges', () => {
  it('added·removed·changed 중 하나라도 있으면 true다', () => {
    expect(hasChanges(diffVariables({}, { A: '1' }))).toBe(true);
    expect(hasChanges(diffVariables({ A: '1' }, {}))).toBe(true);
    expect(hasChanges(diffVariables({ A: '1' }, { A: '2' }))).toBe(true);
  });

  it('unchanged만 있으면 false다', () => {
    expect(hasChanges(diffVariables({ A: '1' }, { A: '1' }))).toBe(false);
  });
});

describe('applyChangeSet', () => {
  it('set의 키는 추가하거나 값을 바꾼다', () => {
    expect(applyChangeSet({ A: '1', B: '2' }, { set: { B: '20', C: '3' } })).toEqual({
      A: '1',
      B: '20',
      C: '3',
    });
  });

  it('remove의 키는 지운다', () => {
    expect(applyChangeSet({ A: '1', B: '2' }, { remove: ['A'] })).toEqual({ B: '2' });
  });

  it('없는 키를 지우려 하면 조용히 넘어간다', () => {
    expect(applyChangeSet({ A: '1' }, { remove: ['GHOST'] })).toEqual({ A: '1' });
  });

  it('빈 변경 집합은 값을 그대로 돌려준다', () => {
    expect(applyChangeSet({ A: '1' }, {})).toEqual({ A: '1' });
  });

  it('같은 키를 set과 remove에 함께 넣으면 ChangeSetConflictError를 던진다', () => {
    const apply = () => applyChangeSet({ A: '1' }, { set: { A: '2', B: '1' }, remove: ['A', 'B'] });
    expect(apply).toThrow(ChangeSetConflictError);
    try {
      apply();
    } catch (error) {
      expect((error as ChangeSetConflictError).keys).toEqual(['A', 'B']);
    }
  });

  it('넘겨받은 객체를 바꾸지 않는다', () => {
    const current = { A: '1', B: '2' };
    applyChangeSet(current, { set: { A: '9' }, remove: ['B'] });
    expect(current).toEqual({ A: '1', B: '2' });
  });
});

describe('createChangeSet', () => {
  it('새로 생기거나 바뀐 키는 set, 사라진 키는 remove에 담는다', () => {
    expect(
      createChangeSet({ KEEP: 'x', OLD: '1', EDIT: 'a' }, { KEEP: 'x', NEW: '2', EDIT: 'b' }),
    ).toEqual({ set: { NEW: '2', EDIT: 'b' }, remove: ['OLD'] });
  });

  it('비어 있는 쪽은 넣지 않는다', () => {
    expect(createChangeSet({ A: '1' }, { A: '2' })).toEqual({ set: { A: '2' } });
    expect(createChangeSet({ A: '1', B: '2' }, { A: '1' })).toEqual({ remove: ['B'] });
    expect(createChangeSet({ A: '1' }, { A: '1' })).toEqual({});
  });

  it('applyChangeSet으로 되돌리면 같은 값이 된다', () => {
    const previous = { A: '1', B: '', C: '3' };
    const next = { A: '1', B: 'x', D: '' };
    expect(applyChangeSet(previous, createChangeSet(previous, next))).toEqual(next);
  });
});
