import { createHmac, createSign, timingSafeEqual } from 'node:crypto';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * GitHub App으로 설치 토큰을 받을 때 쓰는 JWT (RS256).
 * 서버 시계가 조금 빨라도 거부되지 않게 iat을 60초 앞당기고, GitHub 한도(10분) 안인 9분 뒤에 만료한다.
 */
export function createAppJwt(appId: string, privateKey: string, now: Date): string {
  const seconds = Math.floor(now.getTime() / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iat: seconds - 60,
    exp: seconds + 540,
    iss: Number(appId),
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}

/** 웹훅의 `X-Hub-Signature-256`이 받은 본문 바이트의 HMAC-SHA256과 같은지 시간 일정 비교로 확인한다 */
export function verifyWebhookSignature(
  secret: string,
  body: Buffer,
  header: string | undefined,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
