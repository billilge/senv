import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAppJwt, verifyWebhookSignature } from './app-auth.js';

describe('createAppJwt', () => {
  it('App id를 iss로, 60초 앞당긴 iat과 9분 뒤 exp를 담아 RS256으로 서명한다', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const now = new Date('2026-10-08T09:00:00.000Z');

    const [header = '', payload = '', signature = ''] = createAppJwt('123456', pem, now).split('.');

    const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const seconds = now.getTime() / 1000;
    expect(decode(payload)).toEqual({ iat: seconds - 60, exp: seconds + 540, iss: 123456 });
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature, 'base64url'));
    expect(verified).toBe(true);
  });
});

describe('verifyWebhookSignature', () => {
  const body = Buffer.from('{"ref":"refs/heads/main"}');
  const sign = (secret: string, data: Buffer) =>
    `sha256=${createHmac('sha256', secret).update(data).digest('hex')}`;

  it('받은 본문 바이트의 HMAC-SHA256이 맞으면 통과한다', () => {
    expect(verifyWebhookSignature('hook-secret', body, sign('hook-secret', body))).toBe(true);
  });

  it('비밀이 다르거나 본문이 바뀌었으면 거부한다', () => {
    expect(verifyWebhookSignature('hook-secret', body, sign('other', body))).toBe(false);
    const changed = Buffer.from('{"ref":"refs/heads/evil"}');
    expect(verifyWebhookSignature('hook-secret', changed, sign('hook-secret', body))).toBe(false);
  });

  it('서명이 없거나 형식이 다르면 거부한다', () => {
    for (const header of [undefined, '', 'sha1=abcd', 'sha256=zz', 'sha256=']) {
      expect(verifyWebhookSignature('hook-secret', body, header)).toBe(false);
    }
  });
});
