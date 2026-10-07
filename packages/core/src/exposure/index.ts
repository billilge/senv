export type Visibility = 'secret' | 'public';

export interface VisibilityEntry {
  key: string;
  visibility: Visibility;
}

export interface ExposureResult {
  /** secret인데 공개 접두사가 붙어 번들에 들어가는 키. pull·run을 막는다 */
  exposedSecrets: string[];
  /** 스키마에 없는데 공개 접두사가 붙은 키. 막지 않고 경고만 한다 */
  unregistered: string[];
}

/**
 * 앱·웹 번들에 들어가는 키(공개 접두사로 시작하는 키)가 secret이 아닌지 검사한다.
 * 예: Vite는 `VITE_`, Expo는 `EXPO_PUBLIC_`로 시작하는 값을 번들에 넣는다.
 */
export function checkClientExposure(
  keys: string[],
  schema: VisibilityEntry[],
  publicPrefixes: string[],
): ExposureResult {
  const visibilityByKey = new Map(schema.map((entry) => [entry.key, entry.visibility]));
  const result: ExposureResult = { exposedSecrets: [], unregistered: [] };

  for (const key of [...keys].sort()) {
    if (!publicPrefixes.some((prefix) => key.startsWith(prefix))) continue;
    const visibility = visibilityByKey.get(key);
    if (visibility === undefined) result.unregistered.push(key);
    else if (visibility === 'secret') result.exposedSecrets.push(key);
  }

  return result;
}

/** 대문자로 시작하고 밑줄로 끝나는 접두사 (예: `VITE_`, `EXPO_PUBLIC_`) */
const PUBLIC_PREFIX = /^[A-Z][A-Z0-9_]*_$/;

export function isValidPublicPrefix(prefix: string): boolean {
  return PUBLIC_PREFIX.test(prefix);
}
