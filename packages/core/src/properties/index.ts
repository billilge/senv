/**
 * Java `.properties` 형식. Spring Boot가 `spring.config.import=optional:file:<파일>[.properties]`로
 * 읽는 파일을 쓰고, `senv diff`·`push`가 그 파일을 다시 읽는다 (PRD 결정 65).
 * Spring은 이 형식을 ISO-8859-1로 읽으므로 ASCII 밖의 글자는 모두 `\uXXXX`로 쓴다.
 */

export class PropertiesParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'PropertiesParseError';
  }
}

export interface SerializePropertiesOptions {
  /** 파일 맨 위에 `# `를 붙여 쓸 주석 줄 (예: 버전, 생성 시각) */
  header?: string[];
}

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WRITE_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
  '\f': '\\f',
};
const READ_ESCAPES: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f' };
const WHITESPACE = /[ \t\f]/;
const LEADING_WHITESPACE = /^[ \t\f]+/;

/** 키·값을 `.properties` 텍스트로 쓴다. 값은 항상 한 줄이다 */
export function serializeProperties(
  vars: Record<string, string>,
  options: SerializePropertiesOptions = {},
): string {
  const lines = (options.header ?? []).map((comment) => `# ${comment}`);
  for (const [key, value] of Object.entries(vars)) {
    lines.push(`${key}=${escapeValue(value)}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/**
 * 값 안의 `= : # !`는 이스케이프하지 않는다. 구분자 뒤와 줄 중간에서는 특별한 뜻이 없어서
 * Java와 Spring 모두 그대로 읽고, URL을 사람이 읽기 쉽게 남길 수 있다.
 * 맨 앞 공백만 `\ `로 쓴다. 그러지 않으면 구분자 뒤 공백으로 보고 버린다.
 */
function escapeValue(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i] as string;
    const code = value.charCodeAt(i);
    const escaped = WRITE_ESCAPES[char];
    if (escaped) out += escaped;
    else if (char === ' ' && i === 0) out += '\\ ';
    else if (code < 0x20 || code > 0x7e)
      out += `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += char;
  }
  return out;
}

/**
 * `.properties` 텍스트를 키·값으로 읽는다 (java.util.Properties의 규칙).
 * 같은 키가 여러 번 나오면 마지막 값을 쓴다. 키는 senv 키 규칙을 따라야 한다.
 */
export function parseProperties(text: string): Record<string, string> {
  const lines = text.split(/\r\n|\r|\n/);
  const vars: Record<string, string> = {};
  let index = 0;

  while (index < lines.length) {
    const lineNumber = index + 1;
    let line = (lines[index++] ?? '').replace(LEADING_WHITESPACE, '');
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;

    // 홀수 개의 역슬래시로 끝나면 다음 줄이 이어진다
    while (endsWithContinuation(line)) {
      line = line.slice(0, -1);
      if (index >= lines.length) break;
      line += (lines[index++] ?? '').replace(LEADING_WHITESPACE, '');
    }

    const { rawKey, rawValue } = splitEntry(line);
    const key = decodeEscapes(rawKey, lineNumber);
    if (!KEY_PATTERN.test(key)) {
      throw new PropertiesParseError(`${lineNumber}번째 줄: 잘못된 키 이름 "${key}"`, lineNumber);
    }
    vars[key] = decodeEscapes(rawValue, lineNumber);
  }

  return vars;
}

function endsWithContinuation(line: string): boolean {
  let count = 0;
  for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

/** 이스케이프되지 않은 첫 `=`, `:`, 공백에서 키와 값을 나눈다 */
function splitEntry(line: string): { rawKey: string; rawValue: string } {
  let end = 0;
  while (end < line.length) {
    const char = line[end] as string;
    if (char === '\\') {
      end += 2;
      continue;
    }
    if (char === '=' || char === ':' || WHITESPACE.test(char)) break;
    end++;
  }
  const rawKey = line.slice(0, end);
  let rest = line.slice(end);
  let hasSeparator = rest.startsWith('=') || rest.startsWith(':');
  if (hasSeparator) rest = rest.slice(1);
  rest = rest.replace(LEADING_WHITESPACE, '');
  // 공백 구분자 뒤에는 = 또는 : 하나를 더 구분자로 본다 (예: "KEY  =  value")
  if (!hasSeparator && (rest.startsWith('=') || rest.startsWith(':'))) {
    hasSeparator = true;
    rest = rest.slice(1).replace(LEADING_WHITESPACE, '');
  }
  return { rawKey, rawValue: rest };
}

function decodeEscapes(raw: string, lineNumber: number): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i] as string;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = raw[++i];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = raw.slice(i + 1, i + 5);
      if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
        throw new PropertiesParseError(
          `${lineNumber}번째 줄: \\u 다음에는 16진수 네 자리가 와야 합니다`,
          lineNumber,
        );
      }
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 4;
      continue;
    }
    out += READ_ESCAPES[next] ?? next;
  }
  return out;
}
