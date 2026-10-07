import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type Envelope,
  EnvelopeDecryptionError,
  type Keyring,
  openEnvelope,
  rewrapEnvelope,
  sealEnvelope,
  UnknownKekError,
  UnsupportedEnvelopeError,
} from './envelope.js';

const CONTEXT = 'projects/server/production/v13';

function keyring(currentKekId = 'kek-1', keks: Record<string, Buffer> = {}): Keyring {
  return {
    currentKekId,
    keks: new Map(Object.entries({ [currentKekId]: randomBytes(32), ...keks })),
  };
}

/** base64 문자열의 첫 글자를 다른 글자로 바꿔 내용을 훼손한다 */
function tamper(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  return bytes.toString('base64');
}

function expectError(open: () => unknown, errorClass: new (...args: never[]) => Error) {
  expect(open).toThrow(errorClass);
}

describe('sealEnvelope / openEnvelope', () => {
  const ring = keyring();

  it.each([
    ['빈 문자열', ''],
    ['짧은 문자열', 'hello'],
    ['한글·이모지·여러 줄', '한글 값\n두 번째 줄 🚀'],
    ['큰 JSON', JSON.stringify({ variables: { KEY: 'x'.repeat(10_000) } })],
  ])('같은 컨텍스트로 열면 원문(%s)이 그대로 나온다', (_label, plaintext) => {
    const envelope = sealEnvelope(plaintext, CONTEXT, ring);
    expect(openEnvelope(envelope, CONTEXT, ring)).toBe(plaintext);
  });

  it('봉투는 format 1과 현재 kekId를 담고, 바이너리 값은 base64이며, 원문이 보이지 않는다', () => {
    const envelope = sealEnvelope('PAYMENT_SECRET_KEY=sk_live_123', CONTEXT, ring);
    expect(envelope.format).toBe(1);
    expect(envelope.kekId).toBe('kek-1');
    for (const field of ['wrappedDek', 'iv', 'ciphertext', 'tag'] as const) {
      expect(envelope[field]).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    }
    expect(JSON.stringify(envelope)).not.toContain('sk_live_123');
  });

  it('같은 원문을 두 번 봉인해도 DEK·IV·암호문이 매번 다르다', () => {
    const first = sealEnvelope('same', CONTEXT, ring);
    const second = sealEnvelope('same', CONTEXT, ring);
    expect(first.wrappedDek).not.toBe(second.wrappedDek);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('다른 컨텍스트로 열면 EnvelopeDecryptionError다 (다른 위치로 바꿔치기 방지)', () => {
    const envelope = sealEnvelope('prod values', 'projects/server/production/v13', ring);
    expectError(
      () => openEnvelope(envelope, 'projects/server/development/v13', ring),
      EnvelopeDecryptionError,
    );
  });

  it.each(['ciphertext', 'tag', 'wrappedDek', 'iv'] as const)(
    '%s가 바뀌면 EnvelopeDecryptionError다',
    (field) => {
      const envelope = sealEnvelope('values', CONTEXT, ring);
      const tampered: Envelope = { ...envelope, [field]: tamper(envelope[field]) };
      expectError(() => openEnvelope(tampered, CONTEXT, ring), EnvelopeDecryptionError);
    },
  );

  it('id가 같아도 KEK 값이 다르면 EnvelopeDecryptionError다', () => {
    const envelope = sealEnvelope('values', CONTEXT, ring);
    expectError(() => openEnvelope(envelope, CONTEXT, keyring('kek-1')), EnvelopeDecryptionError);
  });

  it('키링에 없는 kekId면 그 id를 담은 UnknownKekError다', () => {
    const envelope = sealEnvelope('values', CONTEXT, ring);
    const other = keyring('kek-2');
    expectError(() => openEnvelope(envelope, CONTEXT, other), UnknownKekError);
    try {
      openEnvelope(envelope, CONTEXT, other);
    } catch (error) {
      expect((error as UnknownKekError).kekId).toBe('kek-1');
    }
  });

  it('format이 1이 아니면 UnsupportedEnvelopeError다', () => {
    const envelope = { ...sealEnvelope('values', CONTEXT, ring), format: 2 } as unknown as Envelope;
    expectError(() => openEnvelope(envelope, CONTEXT, ring), UnsupportedEnvelopeError);
  });
});

describe('KEK 교체', () => {
  const oldKey = randomBytes(32);
  const before: Keyring = { currentKekId: 'kek-old', keks: new Map([['kek-old', oldKey]]) };
  const during: Keyring = {
    currentKekId: 'kek-new',
    keks: new Map([
      ['kek-new', randomBytes(32)],
      ['kek-old', oldKey],
    ]),
  };

  it('교체 중에는 이전 KEK로 봉인한 봉투도 열리고, 새 봉투는 현재 KEK로 봉인한다', () => {
    const old = sealEnvelope('old values', CONTEXT, before);
    expect(openEnvelope(old, CONTEXT, during)).toBe('old values');
    expect(sealEnvelope('new values', CONTEXT, during).kekId).toBe('kek-new');
  });

  it('rewrapEnvelope는 DEK만 현재 KEK로 다시 감싸고 암호문은 그대로 둔다', () => {
    const old = sealEnvelope('old values', CONTEXT, before);
    const rewrapped = rewrapEnvelope(old, during);

    expect(rewrapped.kekId).toBe('kek-new');
    expect(rewrapped.wrappedDek).not.toBe(old.wrappedDek);
    expect({ iv: rewrapped.iv, ciphertext: rewrapped.ciphertext, tag: rewrapped.tag }).toEqual({
      iv: old.iv,
      ciphertext: old.ciphertext,
      tag: old.tag,
    });

    const onlyNew: Keyring = {
      currentKekId: 'kek-new',
      keks: new Map([['kek-new', during.keks.get('kek-new') as Buffer]]),
    };
    expect(openEnvelope(rewrapped, CONTEXT, onlyNew)).toBe('old values');
  });
});
