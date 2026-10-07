import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashToken, issueToken, type TokenKind, tokenKindOf } from './tokens.js';

describe('issueToken', () => {
  it.each([
    ['access', 'senv_at_'],
    ['refresh', 'senv_rt_'],
    ['service', 'senv_st_'],
    ['session', 'senv_ss_'],
  ] as const)('%s 토큰에는 %s 접두사가 붙는다', (kind, prefix) => {
    expect(issueToken(kind).token.startsWith(prefix)).toBe(true);
  });

  it('접두사 뒤는 32바이트 난수를 base64url로 쓴 43자다', () => {
    const { token } = issueToken('access');
    expect(token.slice('senv_at_'.length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('매번 다른 토큰을 만든다', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => issueToken('refresh').token));
    expect(tokens.size).toBe(100);
  });

  it('함께 주는 hash는 토큰의 SHA-256 hex이고 원문을 담지 않는다', () => {
    const { token, hash } = issueToken('session');
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token.slice(8));
  });
});

describe('tokenKindOf', () => {
  it.each(['access', 'refresh', 'service', 'session'] as TokenKind[])(
    '발급한 %s 토큰의 종류를 알아낸다',
    (kind) => {
      expect(tokenKindOf(issueToken(kind).token)).toBe(kind);
    },
  );

  it.each([
    ['빈 문자열', ''],
    ['모르는 접두사', `senv_xx_${'a'.repeat(43)}`],
    ['접두사만 있고 길이가 짧음', 'senv_at_short'],
    ['허용하지 않는 글자', `senv_at_${'a'.repeat(42)}!`],
    ['GitHub 토큰', `ghp_${'a'.repeat(36)}`],
  ])('%s → undefined', (_label, token) => {
    expect(tokenKindOf(token)).toBeUndefined();
  });
});
