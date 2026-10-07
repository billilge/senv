export type VariableType = 'string' | 'url' | 'number' | 'boolean' | 'json';

export interface KeySchema {
  key: string;
  type: VariableType;
  /** 모든 환경에 값이 있어야 하는지 */
  required: boolean;
  /** required여도 값이 없어도 되는 환경 (예: development에서는 SENTRY_DSN 생략 가능) */
  optionalIn?: string[];
}

export type ValidationIssue =
  | { code: 'missing_required'; severity: 'error'; key: string }
  | { code: 'invalid_type'; severity: 'error'; key: string; expected: VariableType }
  | { code: 'unknown_key'; severity: 'warning'; key: string };

const KEY_NAME = /^[A-Z_][A-Z0-9_]*$/;
/** `localhost:3000`처럼 URL로 파싱은 되지만 scheme이 없는 값을 거르기 위해 `scheme://`을 요구한다 */
const URL_WITH_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const DECIMAL = /^-?\d+(\.\d+)?$/;

const VALUE_CHECKS: Record<VariableType, (value: string) => boolean> = {
  string: () => true,
  url: (value) => URL_WITH_SCHEME.test(value) && URL.canParse(value),
  number: (value) => DECIMAL.test(value),
  boolean: (value) => value === 'true' || value === 'false',
  json: (value) => {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  },
};

export function isValidKeyName(key: string): boolean {
  return KEY_NAME.test(key);
}

export function isValidValue(type: VariableType, value: string): boolean {
  return VALUE_CHECKS[type](value);
}

/**
 * 한 환경의 값 전체를 키 스키마와 비교한다.
 * 오류(`severity: 'error'`)가 하나라도 있으면 게시를 막는다. 결과는 키 이름 순이다.
 */
export function validateEnvironment(
  schema: KeySchema[],
  values: Record<string, string>,
  env: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const { key, type, required, optionalIn = [] } of schema) {
    const value = values[key];
    if (value === undefined || value === '') {
      if (required && !optionalIn.includes(env)) {
        issues.push({ code: 'missing_required', severity: 'error', key });
      }
      continue;
    }
    if (!isValidValue(type, value)) {
      issues.push({ code: 'invalid_type', severity: 'error', key, expected: type });
    }
  }

  const known = new Set(schema.map((entry) => entry.key));
  for (const key of Object.keys(values)) {
    if (!known.has(key)) issues.push({ code: 'unknown_key', severity: 'warning', key });
  }

  return issues.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
