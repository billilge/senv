import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { createTestUser } from '../testing/users.js';
import { ApiTokenService } from './api-token-service.js';
import { USER_FIELDS, type UserView } from './auth-service.js';
import {
  DeviceApprovalForbiddenError,
  DeviceAuthService,
  DeviceCodeExpiredError,
  DeviceCodeNotFoundError,
  InvalidDeviceCodeError,
} from './device-auth-service.js';
import { hashToken } from './tokens.js';

const prisma = createTestPrisma();
const T0 = new Date('2026-10-07T09:00:00.000Z');
const SECOND = 1000;
const VERIFY = 'https://senv.stream.billilge.site/device';

let now: Date;
let tokens: ApiTokenService;
let device: DeviceAuthService;
let alice: UserView;

beforeEach(async () => {
  await resetDatabase(prisma);
  now = T0;
  tokens = new ApiTokenService(prisma, () => now);
  device = new DeviceAuthService(prisma, tokens, { verificationUri: VERIFY }, () => now);
  const row = await createTestUser(prisma, { login: 'alice', status: 'active' });
  alice = await prisma.user.findUniqueOrThrow({ where: { id: row.id }, select: USER_FIELDS });
});
afterAll(() => prisma.$disconnect());

const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

describe('DeviceAuthService', () => {
  it('start는 사용자 코드·디바이스 코드·주소를 주고, DB에는 디바이스 코드 해시만 둔다', async () => {
    const started = await device.start();

    expect(started.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(started.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(started).toMatchObject({
      verificationUri: VERIFY,
      verificationUriComplete: `${VERIFY}?code=${started.userCode}`,
      expiresIn: 600,
      interval: 5,
    });
    const row = await prisma.deviceCode.findFirstOrThrow();
    expect(row.deviceCodeHash).toBe(hashToken(started.deviceCode));
    expect(JSON.stringify(row)).not.toContain(started.deviceCode);
  });

  it('승인 전에는 authorization_pending이다', async () => {
    const { deviceCode } = await device.start();
    expect(await device.poll(deviceCode)).toEqual({ status: 'authorization_pending' });
  });

  it('활성 사용자가 승인하면 다음 폴링에서 그 사용자의 토큰을 받는다', async () => {
    const { deviceCode, userCode } = await device.start();
    await device.approve(userCode, alice);

    const result = await device.poll(deviceCode);
    expect(result.status).toBe('approved');
    const { tokens: pair } = result as Extract<typeof result, { status: 'approved' }>;
    expect(await tokens.authenticate(pair.accessToken)).toMatchObject({ login: 'alice' });
  });

  it('토큰은 한 번만 받을 수 있다', async () => {
    const { deviceCode, userCode } = await device.start();
    await device.approve(userCode, alice);
    await device.poll(deviceCode);
    advance(5 * SECOND);
    await expect(device.poll(deviceCode)).rejects.toThrow(InvalidDeviceCodeError);
  });

  it('사용자 코드는 대소문자·하이픈·공백을 가리지 않는다', async () => {
    const { deviceCode, userCode } = await device.start();
    const typed = ` ${userCode.replace('-', ' ').toLowerCase()} `;
    await device.approve(typed, alice);
    expect((await device.poll(deviceCode)).status).toBe('approved');
  });

  it.each(['pending', 'disabled'] as const)('%s 사용자는 승인할 수 없다', async (status) => {
    const { userCode } = await device.start();
    await expect(device.approve(userCode, { ...alice, status })).rejects.toThrow(
      DeviceApprovalForbiddenError,
    );
  });

  it('거절하면 폴링 결과가 access_denied다', async () => {
    const { deviceCode, userCode } = await device.start();
    await device.deny(userCode, alice);
    expect(await device.poll(deviceCode)).toEqual({ status: 'access_denied' });
  });

  it('10분이 지나면 expired_token이고, 만료된 코드는 승인할 수 없다', async () => {
    const { deviceCode, userCode } = await device.start();
    advance(600 * SECOND);
    expect(await device.poll(deviceCode)).toEqual({ status: 'expired_token' });
    await expect(device.approve(userCode, alice)).rejects.toThrow(DeviceCodeExpiredError);
  });

  it('간격보다 빨리 폴링하면 slow_down이고 간격이 5초씩 늘어난다', async () => {
    const { deviceCode } = await device.start();
    await device.poll(deviceCode);

    advance(2 * SECOND);
    expect(await device.poll(deviceCode)).toEqual({ status: 'slow_down', interval: 10 });
    advance(6 * SECOND);
    expect(await device.poll(deviceCode)).toEqual({ status: 'slow_down', interval: 15 });
    advance(15 * SECOND);
    expect(await device.poll(deviceCode)).toEqual({ status: 'authorization_pending' });
  });

  it('없는 디바이스 코드로 폴링하면 InvalidDeviceCodeError다', async () => {
    await expect(device.poll('x'.repeat(43))).rejects.toThrow(InvalidDeviceCodeError);
  });

  it('없는 코드나 이미 처리한 코드는 승인할 수 없다', async () => {
    await expect(device.approve('BCDF-GHJK', alice)).rejects.toThrow(DeviceCodeNotFoundError);
    const { userCode } = await device.start();
    await device.approve(userCode, alice);
    await expect(device.approve(userCode, alice)).rejects.toThrow(DeviceCodeNotFoundError);
  });
});
