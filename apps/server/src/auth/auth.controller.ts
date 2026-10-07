import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AllowPending, CurrentUser, Public } from '../http/access.js';
import { ApiProblem } from '../http/api-error.js';
import {
  apiErrorSchema,
  deviceAuthorizationSchema,
  tokenPairSchema,
  userSchema,
} from '../http/api-schemas.js';
import { RateLimit } from '../http/rate-limit.js';
import { ApiTokenService, type TokenPair } from './api-token-service.js';
import type { UserView } from './auth-service.js';
import { type DeviceAuthorization, DeviceAuthService } from './device-auth-service.js';

const deviceTokenBody = z.object({ deviceCode: z.string().min(1) });
const approveBody = z.object({
  userCode: z.string().min(1),
  decision: z.enum(['approve', 'deny']),
});
const refreshBody = z.object({ refreshToken: z.string().min(1) });
const revokeBody = z.object({ token: z.string().min(1) });

/** 폴링 결과 중 토큰을 주지 않는 상태를 RFC 8628처럼 400 오류 code로 알린다 */
const POLL_MESSAGES = {
  authorization_pending: '브라우저에서 아직 승인하지 않았습니다',
  access_denied: '로그인 요청이 거절되었습니다',
  expired_token: '코드가 만료되었습니다. senv login을 다시 실행하세요',
} as const;

@ApiTags('auth')
@ApiBearerAuth()
@ApiCookieAuth()
@ApiResponse({ status: 'default', description: '오류', standardSchema: apiErrorSchema })
@Controller('api/v1')
export class AuthController {
  constructor(
    @Inject(DeviceAuthService) private readonly device: DeviceAuthService,
    @Inject(ApiTokenService) private readonly tokens: ApiTokenService,
  ) {}

  @Get('me')
  @AllowPending()
  @ApiResponse({ status: 200, standardSchema: userSchema })
  me(@CurrentUser() user: UserView): UserView {
    return user;
  }

  @Post('auth/device')
  @Public()
  @RateLimit('deviceStart')
  @HttpCode(200)
  @ApiResponse({ status: 200, standardSchema: deviceAuthorizationSchema })
  startDeviceLogin(): Promise<DeviceAuthorization> {
    return this.device.start();
  }

  @Post('auth/device/token')
  @Public()
  @RateLimit('tokenIssue')
  @HttpCode(200)
  @ApiResponse({ status: 200, standardSchema: tokenPairSchema })
  async pollDeviceLogin(
    @Body({ schema: deviceTokenBody }) body: z.infer<typeof deviceTokenBody>,
  ): Promise<TokenPair> {
    const result = await this.device.poll(body.deviceCode);
    if (result.status === 'approved') return result.tokens;
    if (result.status === 'slow_down') {
      throw new ApiProblem(400, 'slow_down', '너무 자주 확인했습니다. 간격을 늘리세요', {
        interval: result.interval,
      });
    }
    throw new ApiProblem(400, result.status, POLL_MESSAGES[result.status]);
  }

  /** 브라우저(대시보드)에서 CLI 로그인 코드를 승인하거나 거절한다 */
  @Post('auth/device/approve')
  @RateLimit('deviceApprove')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: '처리됨' })
  async decideDeviceLogin(
    @Body({ schema: approveBody }) body: z.infer<typeof approveBody>,
    @CurrentUser() user: UserView,
  ): Promise<void> {
    if (body.decision === 'approve') await this.device.approve(body.userCode, user);
    else await this.device.deny(body.userCode, user);
  }

  @Post('auth/token/refresh')
  @Public()
  @RateLimit('tokenIssue')
  @HttpCode(200)
  @ApiResponse({ status: 200, standardSchema: tokenPairSchema })
  refresh(@Body({ schema: refreshBody }) body: z.infer<typeof refreshBody>): Promise<TokenPair> {
    return this.tokens.refresh(body.refreshToken);
  }

  /** 토큰을 가진 사람만 폐기할 수 있으므로 인증 없이 받는다 (RFC 7009) */
  @Post('auth/token/revoke')
  @Public()
  @HttpCode(204)
  @ApiResponse({ status: 204, description: '폐기됨' })
  async revoke(@Body({ schema: revokeBody }) body: z.infer<typeof revokeBody>): Promise<void> {
    await this.tokens.revoke(body.token);
  }
}
