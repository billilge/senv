import type { Keyring } from './envelope.js';

export class KeyringConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyringConfigError';
  }
}

const KEK_BYTES = 32;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * 환경변수에서 키링을 만든다. 형식이 틀리면 기동을 막도록 KeyringConfigError를 던진다.
 * 오류 메시지에는 키 값을 절대 담지 않는다.
 * - `SENV_KEK`: 현재 KEK (base64, 32바이트)
 * - `SENV_KEK_ID`: 현재 KEK 식별자
 * - `SENV_KEK_PREVIOUS`: 교체 중인 이전 KEK들 (`id:base64,id:base64`)
 */
export function loadKeyring(env: Record<string, string | undefined>): Keyring {
  const currentKekId = env.SENV_KEK_ID?.trim();
  if (!env.SENV_KEK) throw new KeyringConfigError('SENV_KEK가 설정되지 않았습니다');
  if (!currentKekId) throw new KeyringConfigError('SENV_KEK_ID가 설정되지 않았습니다');

  const keks = new Map([[currentKekId, decodeKek(env.SENV_KEK, 'SENV_KEK')]]);

  for (const entry of (env.SENV_KEK_PREVIOUS ?? '').split(',')) {
    const item = entry.trim();
    if (item === '') continue;
    const separator = item.indexOf(':');
    if (separator <= 0) {
      throw new KeyringConfigError('SENV_KEK_PREVIOUS의 각 항목은 "id:base64" 형식이어야 합니다');
    }
    const id = item.slice(0, separator).trim();
    if (keks.has(id)) throw new KeyringConfigError(`KEK id가 중복됩니다: ${id}`);
    keks.set(id, decodeKek(item.slice(separator + 1), `SENV_KEK_PREVIOUS의 ${id}`));
  }

  return { currentKekId, keks };
}

function decodeKek(value: string, label: string): Buffer {
  const trimmed = value.trim();
  if (!BASE64.test(trimmed)) throw new KeyringConfigError(`${label} 값이 base64 형식이 아닙니다`);
  const key = Buffer.from(trimmed, 'base64');
  if (key.length !== KEK_BYTES) {
    throw new KeyringConfigError(
      `${label} 값은 ${KEK_BYTES}바이트여야 합니다 (현재 ${key.length}바이트)`,
    );
  }
  return key;
}
