import { randomBytes, randomInt } from 'node:crypto';
import { isUniqueViolation } from '../database/errors.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { ApiTokenService, TokenPair } from './api-token-service.js';
import type { UserView } from './auth-service.js';
import { hashToken } from './tokens.js';

export interface DeviceAuthorization {
  /** CLI만 아는 비밀 값. 폴링할 때 쓴다 */
  deviceCode: string;
  /** 사용자가 브라우저에 입력하는 코드 (예: BCDF-GHJK) */
  userCode: string;
  verificationUri: string;
  /** 코드가 미리 채워진 주소 */
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export type PollResult =
  | { status: 'authorization_pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'access_denied' }
  | { status: 'expired_token' }
  | { status: 'approved'; tokens: TokenPair };

export class InvalidDeviceCodeError extends Error {
  constructor() {
    super('디바이스 코드가 유효하지 않습니다');
    this.name = 'InvalidDeviceCodeError';
  }
}

export class DeviceCodeNotFoundError extends Error {
  constructor() {
    super('코드를 찾을 수 없습니다. CLI에 표시된 코드를 다시 확인하세요');
    this.name = 'DeviceCodeNotFoundError';
  }
}

export class DeviceCodeExpiredError extends Error {
  constructor() {
    super('코드가 만료되었습니다. CLI에서 senv login을 다시 실행하세요');
    this.name = 'DeviceCodeExpiredError';
  }
}

export class DeviceApprovalForbiddenError extends Error {
  constructor() {
    super('관리자가 승인한 활성 사용자만 CLI 로그인을 승인할 수 있습니다');
    this.name = 'DeviceApprovalForbiddenError';
  }
}

/** RFC 8628 권장: 모음과 헷갈리는 글자를 뺀 20글자에서 8자 */
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const USER_CODE_LENGTH = 8;
const EXPIRES_IN_SECONDS = 600;
const INTERVAL_SECONDS = 5;
/** 너무 빨리 폴링하면 간격을 이만큼 늘린다 (RFC 8628 3.5) */
const SLOW_DOWN_SECONDS = 5;

/** CLI 디바이스 로그인 (RFC 8628). 브라우저에서 로그인한 활성 사용자가 코드를 승인한다 */
export class DeviceAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: ApiTokenService,
    private readonly options: { verificationUri: string },
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(): Promise<DeviceAuthorization> {
    // 사용자 코드가 우연히 겹치면 새 코드로 다시 만든다
    for (let attempt = 1; ; attempt++) {
      const deviceCode = randomBytes(32).toString('base64url');
      const userCode = randomUserCode();
      const now = this.now();
      try {
        await this.prisma.deviceCode.create({
          data: {
            deviceCodeHash: hashToken(deviceCode),
            userCode,
            intervalSeconds: INTERVAL_SECONDS,
            createdAt: now,
            expiresAt: new Date(now.getTime() + EXPIRES_IN_SECONDS * 1000),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error) && attempt < 3) continue;
        throw error;
      }
      const display = `${userCode.slice(0, 4)}-${userCode.slice(4)}`;
      return {
        deviceCode,
        userCode: display,
        verificationUri: this.options.verificationUri,
        verificationUriComplete: `${this.options.verificationUri}?code=${display}`,
        expiresIn: EXPIRES_IN_SECONDS,
        interval: INTERVAL_SECONDS,
      };
    }
  }

  async approve(userCode: string, user: UserView): Promise<void> {
    await this.decide(userCode, user, 'approved');
  }

  async deny(userCode: string, user: UserView): Promise<void> {
    await this.decide(userCode, user, 'denied');
  }

  async poll(deviceCode: string): Promise<PollResult> {
    const row = await this.prisma.deviceCode.findUnique({
      where: { deviceCodeHash: hashToken(deviceCode) },
    });
    if (!row || row.status === 'consumed') throw new InvalidDeviceCodeError();

    const now = this.now();
    if (row.expiresAt <= now) return { status: 'expired_token' };

    if (
      row.lastPolledAt &&
      now.getTime() - row.lastPolledAt.getTime() < row.intervalSeconds * 1000
    ) {
      const interval = row.intervalSeconds + SLOW_DOWN_SECONDS;
      await this.prisma.deviceCode.update({
        where: { id: row.id },
        data: { intervalSeconds: interval, lastPolledAt: now },
      });
      return { status: 'slow_down', interval };
    }
    await this.prisma.deviceCode.update({ where: { id: row.id }, data: { lastPolledAt: now } });

    if (row.status === 'pending') return { status: 'authorization_pending' };
    if (row.status === 'denied') return { status: 'access_denied' };

    // 승인된 코드는 한 번만 토큰으로 바꾼다. 동시에 폴링해도 한쪽만 이긴다
    const { count } = await this.prisma.deviceCode.updateMany({
      where: { id: row.id, status: 'approved' },
      data: { status: 'consumed' },
    });
    if (count === 0 || !row.userId) throw new InvalidDeviceCodeError();
    return { status: 'approved', tokens: await this.tokens.issuePair(row.userId) };
  }

  private async decide(input: string, user: UserView, status: 'approved' | 'denied') {
    if (user.status !== 'active') throw new DeviceApprovalForbiddenError();
    const userCode = input.toUpperCase().replace(/[^A-Z]/g, '');
    const row = await this.prisma.deviceCode.findUnique({ where: { userCode } });
    if (row?.status !== 'pending') throw new DeviceCodeNotFoundError();
    if (row.expiresAt <= this.now()) throw new DeviceCodeExpiredError();

    const { count } = await this.prisma.deviceCode.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status, userId: user.id },
    });
    if (count === 0) throw new DeviceCodeNotFoundError();
  }
}

function randomUserCode(): string {
  let code = '';
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return code;
}
