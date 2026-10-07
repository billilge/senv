import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** 봉투를 만들고 여는 데 쓰는 마스터 키(KEK) 묶음. 교체 중에는 이전 키도 함께 들고 있다 */
export interface Keyring {
  currentKekId: string;
  keks: ReadonlyMap<string, Buffer>;
}

/** R2에 저장되는 암호화 봉투 (PRD 5.3). 바이너리 값은 모두 base64 문자열이다 */
export interface Envelope {
  format: 1;
  kekId: string;
  /** KEK로 감싼 DEK: base64(iv + 암호문 + tag) */
  wrappedDek: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

export class EnvelopeDecryptionError extends Error {
  constructor() {
    super('봉투를 열 수 없습니다 (키가 다르거나, 내용이 바뀌었거나, 위치가 다릅니다)');
    this.name = 'EnvelopeDecryptionError';
  }
}

export class UnknownKekError extends Error {
  constructor(readonly kekId: string) {
    super(`키링에 없는 KEK입니다: ${kekId}`);
    this.name = 'UnknownKekError';
  }
}

export class UnsupportedEnvelopeError extends Error {
  constructor(readonly format: unknown) {
    super(`지원하지 않는 봉투 형식입니다: ${String(format)}`);
    this.name = 'UnsupportedEnvelopeError';
  }
}

const ALGORITHM = 'aes-256-gcm';
const DEK_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * 스냅샷마다 새 DEK로 원문을 AES-256-GCM 암호화하고, DEK는 현재 KEK로 감싼다.
 * `context`(예: `projects/server/production/v13`)는 인증 데이터로 묶여서, 같은 값으로만 열 수 있다.
 */
export function sealEnvelope(plaintext: string, context: string, keyring: Keyring): Envelope {
  const kekId = keyring.currentKekId;
  const kek = requireKek(keyring, kekId);
  const dek = randomBytes(DEK_BYTES);
  try {
    const sealed = encrypt(dek, Buffer.from(plaintext, 'utf8'), Buffer.from(context, 'utf8'));
    return {
      format: 1,
      kekId,
      wrappedDek: wrapDek(dek, kek, kekId),
      iv: sealed.iv.toString('base64'),
      ciphertext: sealed.ciphertext.toString('base64'),
      tag: sealed.tag.toString('base64'),
    };
  } finally {
    dek.fill(0);
  }
}

export function openEnvelope(envelope: Envelope, context: string, keyring: Keyring): string {
  const kek = kekFor(envelope, keyring);
  return withDecryptionError(() => {
    const dek = unwrapDek(envelope.wrappedDek, kek, envelope.kekId);
    try {
      return decrypt(
        dek,
        Buffer.from(envelope.iv, 'base64'),
        Buffer.from(envelope.ciphertext, 'base64'),
        Buffer.from(envelope.tag, 'base64'),
        Buffer.from(context, 'utf8'),
      ).toString('utf8');
    } finally {
      dek.fill(0);
    }
  });
}

/** KEK 교체용: DEK만 현재 KEK로 다시 감싼다. 본문(iv·ciphertext·tag)은 복호화하지 않는다 */
export function rewrapEnvelope(envelope: Envelope, keyring: Keyring): Envelope {
  const oldKek = kekFor(envelope, keyring);
  const newKek = requireKek(keyring, keyring.currentKekId);
  const dek = withDecryptionError(() => unwrapDek(envelope.wrappedDek, oldKek, envelope.kekId));
  try {
    return {
      ...envelope,
      kekId: keyring.currentKekId,
      wrappedDek: wrapDek(dek, newKek, keyring.currentKekId),
    };
  } finally {
    dek.fill(0);
  }
}

function kekFor(envelope: Envelope, keyring: Keyring): Buffer {
  if (envelope.format !== 1) throw new UnsupportedEnvelopeError(envelope.format);
  return requireKek(keyring, envelope.kekId);
}

function requireKek(keyring: Keyring, kekId: string): Buffer {
  const kek = keyring.keks.get(kekId);
  if (!kek) throw new UnknownKekError(kekId);
  return kek;
}

/** 인증 실패, 길이 오류 등 복호화 중 생기는 오류를 모두 EnvelopeDecryptionError 하나로 바꾼다 */
function withDecryptionError<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof EnvelopeDecryptionError) throw error;
    throw new EnvelopeDecryptionError();
  }
}

/** DEK를 KEK로 감싼다. kekId를 인증 데이터로 묶어 다른 id로 옮겨 쓰지 못하게 한다 */
function wrapDek(dek: Buffer, kek: Buffer, kekId: string): string {
  const { iv, ciphertext, tag } = encrypt(kek, dek, Buffer.from(kekId, 'utf8'));
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

function unwrapDek(wrapped: string, kek: Buffer, kekId: string): Buffer {
  const bytes = Buffer.from(wrapped, 'base64');
  if (bytes.length !== IV_BYTES + DEK_BYTES + TAG_BYTES) throw new EnvelopeDecryptionError();
  return decrypt(
    kek,
    bytes.subarray(0, IV_BYTES),
    bytes.subarray(IV_BYTES, IV_BYTES + DEK_BYTES),
    bytes.subarray(IV_BYTES + DEK_BYTES),
    Buffer.from(kekId, 'utf8'),
  );
}

function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ciphertext, tag: cipher.getAuthTag() };
}

function decrypt(key: Buffer, iv: Buffer, ciphertext: Buffer, tag: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
