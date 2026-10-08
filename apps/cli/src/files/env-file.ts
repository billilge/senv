import { parseDotenv, parseProperties, serializeDotenv, serializeProperties } from '@senv/core';
import type { EnvFileFormat } from '../config/project-config.js';

/** senv.json의 format에 맞춰 값 파일을 쓴다 */
export function serializeEnvFile(
  format: EnvFileFormat,
  vars: Record<string, string>,
  header: string[] = [],
): string {
  return format === 'properties'
    ? serializeProperties(vars, { header })
    : serializeDotenv(vars, { header });
}

/** senv.json의 format에 맞춰 값 파일을 읽는다 (diff·push) */
export function parseEnvFile(format: EnvFileFormat, text: string): Record<string, string> {
  return format === 'properties' ? parseProperties(text) : parseDotenv(text);
}

/**
 * 파일을 읽는 도구가 값을 바꿔 버릴 수 있는 키.
 * dotenv: Vite·Expo가 `$VAR`를 치환한다 (결정 28). properties: Spring이 `${...}`를 치환한다 (결정 65).
 */
export function substitutedKeys(format: EnvFileFormat, vars: Record<string, string>): string[] {
  const marker = format === 'properties' ? '${' : '$';
  return Object.keys(vars).filter((key) => vars[key]?.includes(marker));
}
