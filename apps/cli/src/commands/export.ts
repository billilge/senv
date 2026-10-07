import { type EnvironmentName, serializeDotenv } from '@senv/core';
import type { CliContext } from '../context.js';
import { fetchVariables, resolveTarget } from './target.js';

export const EXPORT_FORMATS = ['dotenv', 'json', 'shell', 'yaml'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** senv export: 원하는 형식으로 표준 출력에 쓴다 (PRD 6.2). 노출 검사는 pull과 같다 */
export async function exportValues(
  context: CliContext,
  options: { env?: EnvironmentName; format?: ExportFormat } = {},
): Promise<void> {
  const delivered = await fetchVariables(context, await resolveTarget(context, options.env));
  const entries = Object.entries(delivered.variables).sort(([a], [b]) => (a < b ? -1 : 1));
  context.out.result(format(entries, options.format ?? 'dotenv'));
}

function format(entries: [string, string][], kind: ExportFormat): string {
  switch (kind) {
    case 'json':
      return JSON.stringify(Object.fromEntries(entries), null, 2);
    case 'shell':
      // 작은따옴표 안에서는 아무것도 치환되지 않는다. 작은따옴표만 '\'' 로 바꾼다
      return entries
        .map(([key, value]) => `export ${key}='${value.replaceAll("'", "'\\''")}'`)
        .join('\n');
    case 'yaml':
      // JSON 문자열은 그대로 YAML 문자열이다
      return entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
    case 'dotenv':
      return serializeDotenv(Object.fromEntries(entries)).trimEnd();
  }
}
