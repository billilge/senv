export interface VariableDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

/** 게시 요청에 담기는 변경 내용 */
export interface ChangeSet {
  set?: Record<string, string>;
  remove?: string[];
}

export class ChangeSetConflictError extends Error {
  constructor(readonly keys: string[]) {
    super(`같은 키를 동시에 설정하고 삭제할 수 없습니다: ${keys.join(', ')}`);
    this.name = 'ChangeSetConflictError';
  }
}

/** 두 값 묶음을 키 단위로 비교한다. 값은 담지 않고 키 이름만 돌려준다 */
export function diffVariables(
  previous: Record<string, string>,
  next: Record<string, string>,
): VariableDiff {
  const diff: VariableDiff = { added: [], removed: [], changed: [], unchanged: [] };
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);

  for (const key of [...keys].sort()) {
    const inPrevious = Object.hasOwn(previous, key);
    const inNext = Object.hasOwn(next, key);
    if (!inPrevious) diff.added.push(key);
    else if (!inNext) diff.removed.push(key);
    else if (previous[key] !== next[key]) diff.changed.push(key);
    else diff.unchanged.push(key);
  }

  return diff;
}

export function hasChanges(diff: VariableDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}

/** 변경 집합을 적용한 새 객체를 돌려준다. 없는 키를 지우는 요청은 무시한다 */
export function applyChangeSet(
  current: Record<string, string>,
  changes: ChangeSet,
): Record<string, string> {
  const set = changes.set ?? {};
  const remove = changes.remove ?? [];

  const conflicts = remove.filter((key) => Object.hasOwn(set, key)).sort();
  if (conflicts.length > 0) throw new ChangeSetConflictError(conflicts);

  const next = { ...current, ...set };
  for (const key of remove) delete next[key];
  return next;
}
