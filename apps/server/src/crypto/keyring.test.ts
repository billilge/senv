import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KeyringConfigError, loadKeyring } from './keyring.js';

const key = () => randomBytes(32).toString('base64');

describe('loadKeyring', () => {
  it('SENV_KEK와 SENV_KEK_ID로 현재 KEK를 만든다', () => {
    const kek = key();
    const ring = loadKeyring({ SENV_KEK: kek, SENV_KEK_ID: 'kek-2026-10' });
    expect(ring.currentKekId).toBe('kek-2026-10');
    expect(ring.keks.get('kek-2026-10')?.equals(Buffer.from(kek, 'base64'))).toBe(true);
    expect(ring.keks.size).toBe(1);
  });

  it('SENV_KEK_PREVIOUS의 이전 KEK들을 함께 올린다', () => {
    const ring = loadKeyring({
      SENV_KEK: key(),
      SENV_KEK_ID: 'kek-3',
      SENV_KEK_PREVIOUS: `kek-1:${key()}, kek-2:${key()}`,
    });
    expect([...ring.keks.keys()].sort()).toEqual(['kek-1', 'kek-2', 'kek-3']);
    expect(ring.currentKekId).toBe('kek-3');
  });

  it.each([
    ['SENV_KEK가 없음', { SENV_KEK_ID: 'kek-1' }],
    ['SENV_KEK_ID가 없음', { SENV_KEK: key() }],
    ['SENV_KEK_ID가 빈 문자열', { SENV_KEK: key(), SENV_KEK_ID: '' }],
    ['SENV_KEK가 16바이트', { SENV_KEK: randomBytes(16).toString('base64'), SENV_KEK_ID: 'k' }],
    ['SENV_KEK가 base64가 아님', { SENV_KEK: 'not base64 !!!', SENV_KEK_ID: 'k' }],
    ['이전 KEK 항목에 id가 없음', { SENV_KEK: key(), SENV_KEK_ID: 'k', SENV_KEK_PREVIOUS: key() }],
    [
      '이전 KEK 길이가 틀림',
      {
        SENV_KEK: key(),
        SENV_KEK_ID: 'k',
        SENV_KEK_PREVIOUS: `old:${randomBytes(8).toString('base64')}`,
      },
    ],
    [
      '이전 KEK id가 현재 id와 같음',
      { SENV_KEK: key(), SENV_KEK_ID: 'k', SENV_KEK_PREVIOUS: `k:${key()}` },
    ],
  ])('%s → KeyringConfigError로 기동을 막는다', (_label, env) => {
    expect(() => loadKeyring(env)).toThrow(KeyringConfigError);
  });

  it('오류 메시지에 키 값을 담지 않는다', () => {
    const shortKey = randomBytes(16).toString('base64');
    try {
      loadKeyring({ SENV_KEK: shortKey, SENV_KEK_ID: 'k' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KeyringConfigError);
      expect((error as Error).message).not.toContain(shortKey);
    }
  });
});
