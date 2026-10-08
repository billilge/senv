import { findClosingQuote } from '../dotenv/quotes';
import type { Visibility } from '../exposure';
import { isValidKeyName } from '../schema';

/** 키 스키마 설명 한도 (DB VARCHAR(500)) */
const DESCRIPTION_LIMIT = 500;

const ASSIGNMENT = /^(?:export\s+)?([^=]*)=(.*)$/;
/** 같은 글자(─, -, =, * 따위)가 네 개 이상 이어지면 구역을 나누는 줄로 본다 (예: `# ── 서버 ───`) */
const DIVIDER = /([─━=\-*~#_])\1{3,}/;

export interface ExampleEntry {
  key: string;
  /** 키 바로 위에 붙은 주석, 없으면 같은 줄 뒤의 주석 */
  description: string;
}

export interface SkippedExampleLine {
  line: number;
  /** invalid_key: 키 이름 규칙(대문자·숫자·밑줄)에 맞지 않음, no_assignment: `=`가 없음 */
  reason: 'invalid_key' | 'no_assignment';
}

export interface ParsedExample {
  entries: ExampleEntry[];
  /** 읽지 못한 줄. 값이 들어 있을 수 있어 내용은 남기지 않는다 */
  skipped: SkippedExampleLine[];
}

/** 키 스키마에 새로 등록할 예시 키. 나머지 속성(선택, string, 빌드 시점 아님)은 기본값이다 */
export interface ExampleKeyToRegister {
  key: string;
  visibility: Visibility;
  description: string;
}

/**
 * `.env.example`에서 키 이름과 설명만 읽는다 (PRD 결정 74).
 * 예시 파일에 진짜 값이 들어 있어도 퍼지지 않게 값은 돌려주지 않는다.
 * 읽지 못한 줄은 건너뛰고, 같은 키가 여러 번 나오면 처음 것만 쓴다.
 */
export function parseEnvExample(text: string): ParsedExample {
  const lines = text.split(/\r?\n/);
  const entries: ExampleEntry[] = [];
  const skipped: SkippedExampleLine[] = [];
  const seen = new Set<string>();
  let comments: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? '').trim();
    if (line.startsWith('#')) {
      const comment = stripComment(line);
      if (!DIVIDER.test(comment)) comments.push(comment);
      continue;
    }
    // 빈 줄이나 다른 줄이 끼면 위 주석은 이 키의 설명이 아니다
    const above = comments.filter(Boolean).join(' ');
    comments = [];
    if (line === '') continue;

    const lineNumber = index + 1;
    const match = ASSIGNMENT.exec(line);
    if (!match) {
      skipped.push({ line: lineNumber, reason: 'no_assignment' });
      continue;
    }
    const value = skipValue(match[2] ?? '', lines, index);
    index = value.end;

    const key = (match[1] ?? '').trim();
    if (!isValidKeyName(key)) {
      skipped.push({ line: lineNumber, reason: 'invalid_key' });
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ key, description: truncate(above || value.comment) });
  }

  return { entries, skipped };
}

/**
 * 키 스키마에 없는 예시 키만 골라 등록할 속성을 붙인다. 이미 있는 키는 건드리지 않는다.
 * 공개 접두사로 시작하는 키를 secret으로 두면 노출 검사에 걸리므로 public으로 등록한다.
 */
export function planExampleImport(
  entries: ExampleEntry[],
  schema: { key: string }[],
  publicPrefixes: string[],
): ExampleKeyToRegister[] {
  const known = new Set(schema.map((entry) => entry.key));
  return entries
    .filter((entry) => !known.has(entry.key))
    .map(({ key, description }) => ({
      key,
      visibility: publicPrefixes.some((prefix) => key.startsWith(prefix)) ? 'public' : 'secret',
      description,
    }));
}

/** 이전 예시와 비교해 더해진 키와 빠진 키 (이름 순) */
export function diffKeyNames(
  before: string[],
  after: string[],
): { added: string[]; removed: string[] } {
  const previous = new Set(before);
  const next = new Set(after);
  return {
    added: [...next].filter((key) => !previous.has(key)).sort(),
    removed: [...previous].filter((key) => !next.has(key)).sort(),
  };
}

/**
 * 값을 건너뛰고 같은 줄 뒤의 주석과 값이 끝나는 줄을 돌려준다.
 * 따옴표 값이 다음 줄에서 닫히면 그 줄까지 넘기고, 끝까지 닫히지 않으면 이 줄만 값으로 본다.
 */
function skipValue(rest: string, lines: string[], index: number): { comment: string; end: number } {
  const value = rest.trimStart();
  const quote = value[0];
  if (quote !== '"' && quote !== "'") {
    const commentAt = rest.search(/\s#/);
    return { comment: commentAt === -1 ? '' : stripComment(rest.slice(commentAt)), end: index };
  }
  for (let next = index; next < lines.length; next++) {
    const buffer = next === index ? value.slice(1) : (lines[next] ?? '');
    const close = findClosingQuote(buffer, quote);
    if (close === -1) continue;
    const trailing = buffer.slice(close + 1).trim();
    return { comment: trailing.startsWith('#') ? stripComment(trailing) : '', end: next };
  }
  return { comment: '', end: index };
}

function stripComment(text: string): string {
  return text.trim().replace(/^#+/, '').trim();
}

/** 글자(코드 포인트) 단위로 자른다. UTF-16 대리 쌍을 반으로 가르지 않는다 */
function truncate(text: string): string {
  return Array.from(text).slice(0, DESCRIPTION_LIMIT).join('');
}
