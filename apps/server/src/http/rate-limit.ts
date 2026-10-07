import { applyDecorators, type ExecutionContext, Injectable, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { ApiProblem } from './api-error.js';

const MINUTE = 60_000;

/**
 * 경로별 IP당 1분 한도 (PRD 4.2). 한 사무실 IP 뒤에 여러 사람이 있어도 걸리지 않을 만큼 넉넉하게 둔다.
 * 폴링(5초 간격 = 1분 12번)과 refresh는 여러 사람이 동시에 해도 되도록 더 넉넉하다.
 */
export const RATE_LIMITS = {
  /** GitHub 로그인 시작·콜백 */
  webLogin: { limit: 20, ttl: MINUTE },
  /** CLI 디바이스 로그인 시작 */
  deviceStart: { limit: 10, ttl: MINUTE },
  /** 브라우저에서 사용자 코드 승인·거절. 사용자 코드를 추측하지 못하게 낮게 둔다 */
  deviceApprove: { limit: 10, ttl: MINUTE },
  /** 디바이스 폴링, refresh로 토큰 발급 */
  tokenIssue: { limit: 60, ttl: MINUTE },
} as const;

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ApiProblem(
      429,
      'too_many_requests',
      `요청이 너무 많습니다. ${detail.timeToBlockExpire}초 뒤에 다시 시도하세요`,
      { retryAfter: detail.timeToBlockExpire },
    );
  }
}

/** 이 경로에 속도 제한을 건다. 표시하지 않은 경로는 제한하지 않는다 */
export const RateLimit = (name: keyof typeof RATE_LIMITS) =>
  applyDecorators(UseGuards(RateLimitGuard), Throttle({ default: RATE_LIMITS[name] }));
