import { isValidKeyName } from '../schema';

export interface ReferenceIssue {
  code: 'missing_reference' | 'invalid_reference';
  /** 참조가 들어 있는 변수 */
  key: string;
  /** 값에 적힌 참조 그대로 (예: `${shared.API_URL}`) */
  reference: string;
}

export interface ResolvedReferences {
  values: Record<string, string>;
  issues: ReferenceIssue[];
}

const SHARED_REFERENCE = /\$\{shared\.([^}]*)\}/g;

/**
 * 값 안의 `${shared.KEY}`를 공유 그룹 값으로 바꾼다. 한 번만 치환하므로
 * 공유 값 안의 참조는 해석하지 않는다. 깨진 참조는 그대로 두고 이슈로 알린다.
 */
export function resolveSharedReferences(
  values: Record<string, string>,
  shared: Record<string, string>,
): ResolvedReferences {
  const resolved: Record<string, string> = {};
  const issues: ReferenceIssue[] = [];

  for (const [key, value] of Object.entries(values)) {
    // 함수로 치환해야 공유 값의 `$&` 같은 글자가 치환 패턴으로 해석되지 않는다
    resolved[key] = value.replace(SHARED_REFERENCE, (reference, name: string) => {
      if (!isValidKeyName(name)) {
        issues.push({ code: 'invalid_reference', key, reference });
        return reference;
      }
      if (!Object.hasOwn(shared, name)) {
        issues.push({ code: 'missing_reference', key, reference });
        return reference;
      }
      return shared[name] as string;
    });
  }

  // 정렬은 안정적이므로 같은 키 안에서는 나온 순서가 유지된다
  issues.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { values: resolved, issues };
}
