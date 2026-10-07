/** 환경은 세 개로 고정이다 (PRD 5.1) */
export const ENVIRONMENT_NAMES = ['local', 'development', 'production'] as const;
export type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

/** 공유 그룹은 이 이름의 특수 프로젝트다 */
export const SHARED_PROJECT_NAME = 'shared';

/** 소문자·숫자·하이픈, 소문자나 숫자로 시작하고 끝남, 32자 이하 */
const PROJECT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function isEnvironmentName(name: string): name is EnvironmentName {
  return (ENVIRONMENT_NAMES as readonly string[]).includes(name);
}

export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME.test(name);
}

/**
 * 버전 번호에 조사 "로/으로"를 붙인다 (예: v1로, v3으로).
 * 숫자를 읽었을 때 마지막 글자에 받침이 있으면(영·삼·육, 그리고 십·백·천으로 끝나는 0) "으로",
 * 받침이 없거나 ㄹ이면(일·칠·팔 등) "로"다.
 */
export function versionRo(version: number): string {
  const last = version % 10;
  return `v${version}${last === 0 || last === 3 || last === 6 ? '으로' : '로'}`;
}
