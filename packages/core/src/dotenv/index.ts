export class DotenvParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'DotenvParseError';
  }
}

export interface SerializeDotenvOptions {
  /** 파일 맨 위에 `# `를 붙여 쓸 주석 줄 (예: 버전, 생성 시각) */
  header?: string[];
}

const ASSIGNMENT = /^(?:export\s+)?([^=]*)=(.*)$/;
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DOUBLE_QUOTE_ESCAPES: Record<string, string> = { n: '\n', r: '\r', '"': '"', '\\': '\\' };
/** 이 글자가 하나라도 있으면 따옴표 없이 쓸 수 없다 */
const NEEDS_QUOTES = /[\s#"'\\]/;

/**
 * `.env` 텍스트를 키·값으로 읽는다. `$` 치환은 하지 않는다.
 * 같은 키가 여러 번 나오면 마지막 값을 쓴다.
 */
export function parseDotenv(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const vars: Record<string, string> = {};
  let index = 0;

  while (index < lines.length) {
    const lineNumber = index + 1;
    const line = (lines[index++] ?? '').trimStart();
    if (line === '' || line.startsWith('#')) continue;

    const match = ASSIGNMENT.exec(line);
    if (!match) {
      throw new DotenvParseError(`${lineNumber}번째 줄에 '='이 없습니다`, lineNumber);
    }
    const key = (match[1] ?? '').trim();
    if (!KEY_PATTERN.test(key)) {
      throw new DotenvParseError(`${lineNumber}번째 줄: 잘못된 키 이름 "${key}"`, lineNumber);
    }

    const rest = match[2] ?? '';
    const valueStart = rest.trimStart();
    const quote = valueStart[0];
    if (quote !== '"' && quote !== "'") {
      vars[key] = readUnquoted(rest);
      continue;
    }

    // 닫는 따옴표가 나올 때까지 다음 줄을 이어 붙인다
    let buffer = valueStart.slice(1);
    let content = '';
    let closingLine = lineNumber;
    let close = findClosingQuote(buffer, quote);
    while (close === -1) {
      if (index >= lines.length) {
        throw new DotenvParseError(
          `${lineNumber}번째 줄에서 시작한 따옴표가 닫히지 않았습니다`,
          lineNumber,
        );
      }
      content += `${buffer}\n`;
      buffer = lines[index++] ?? '';
      closingLine++;
      close = findClosingQuote(buffer, quote);
    }
    content += buffer.slice(0, close);

    const trailing = buffer.slice(close + 1).trim();
    if (trailing !== '' && !trailing.startsWith('#')) {
      throw new DotenvParseError(
        `${closingLine}번째 줄: 닫는 따옴표 뒤에 알 수 없는 글자가 있습니다`,
        closingLine,
      );
    }
    vars[key] = quote === '"' ? unescapeDoubleQuoted(content) : content;
  }

  return vars;
}

/**
 * 키·값을 `.env` 텍스트로 쓴다. 특수 문자가 있는 값은 큰따옴표로 감싸고,
 * 줄바꿈은 `\n`으로 이스케이프해 항상 한 줄에 쓴다.
 */
export function serializeDotenv(
  vars: Record<string, string>,
  options: SerializeDotenvOptions = {},
): string {
  const lines = (options.header ?? []).map((comment) => `# ${comment}`);
  for (const [key, value] of Object.entries(vars)) {
    lines.push(`${key}=${formatValue(value)}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** 따옴표 없는 값: 공백 뒤의 `#`부터는 주석으로 보고, 앞뒤 공백을 없앤다 */
function readUnquoted(rest: string): string {
  const commentAt = rest.search(/\s#/);
  return (commentAt === -1 ? rest : rest.slice(0, commentAt)).trim();
}

function findClosingQuote(text: string, quote: '"' | "'"): number {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote === '"' && char === '\\') {
      i++; // 이스케이프된 다음 글자는 닫는 따옴표가 아니다
      continue;
    }
    if (char === quote) return i;
  }
  return -1;
}

function unescapeDoubleQuoted(content: string): string {
  return content.replace(
    /\\([\s\S])/g,
    (_match, char: string) => DOUBLE_QUOTE_ESCAPES[char] ?? `\\${char}`,
  );
}

function formatValue(value: string): string {
  if (!NEEDS_QUOTES.test(value)) return value;
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}
