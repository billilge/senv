import { createHash, randomBytes } from 'node:crypto';

/** 접두사로 종류를 알 수 있는 불투명 토큰. 서버에는 해시만 저장한다 */
export type TokenKind = 'access' | 'refresh' | 'service' | 'session';

export interface IssuedToken {
  /** 사용자에게 한 번만 건네는 원문 */
  token: string;
  /** DB에 저장하는 SHA-256 해시 (hex) */
  hash: string;
}

/** 시크릿 스캐닝 도구가 찾을 수 있도록 종류별 접두사를 붙인다 (PRD 9.2) */
const PREFIXES: Record<TokenKind, string> = {
  access: 'senv_at_',
  refresh: 'senv_rt_',
  service: 'senv_st_',
  session: 'senv_ss_',
};
const TOKEN_BYTES = 32;
/** base64url로 쓴 32바이트 = 43자 (패딩 없음) */
const BODY = /^[A-Za-z0-9_-]{43}$/;

export function issueToken(kind: TokenKind): IssuedToken {
  const token = PREFIXES[kind] + randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 형식이 맞는 토큰이면 종류를, 아니면 undefined를 돌려준다. DB 조회 전에 걸러낼 때 쓴다 */
export function tokenKindOf(token: string): TokenKind | undefined {
  for (const [kind, prefix] of Object.entries(PREFIXES) as [TokenKind, string][]) {
    if (token.startsWith(prefix)) return BODY.test(token.slice(prefix.length)) ? kind : undefined;
  }
  return undefined;
}
