import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SERVER_CONFIG } from '../app/app-dependencies.js';
import { ApiTokenService } from '../auth/api-token-service.js';
import type { UserView } from '../auth/auth-service.js';
import { SessionService } from '../auth/session-service.js';
import type { ServerConfig } from '../config/server-config.js';
import { AdminRequiredError } from '../users/users-service.js';
import { ACCESS_KEY, type AccessLevel, SESSION_COOKIE, VIA_KEY } from './access.js';
import { ApiProblem } from './api-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 모든 경로에 걸리는 인증 가드.
 * CLI는 Bearer access 토큰, 대시보드는 세션 쿠키를 쓴다.
 * 쿠키로 인증하는 쓰기 요청은 Origin이 APP_URL과 같아야 한다 (CSRF, PRD 결정 기록).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ApiTokenService) private readonly tokens: ApiTokenService,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access =
      this.reflector.getAllAndOverride<AccessLevel | undefined>(ACCESS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'active';
    if (access === 'public') return true;

    const request = context.switchToHttp().getRequest<Request & { user?: UserView }>();
    const tokenOnly =
      this.reflector.getAllAndOverride<string | undefined>(VIA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === 'token';
    if (tokenOnly && !request.headers.authorization?.startsWith('Bearer ')) {
      throw new ApiProblem(403, 'cli_token_required', '이 요청은 senv CLI에서만 할 수 있습니다');
    }
    const user = await this.authenticate(request);
    if (!user) throw new ApiProblem(401, 'unauthorized', '로그인이 필요합니다');
    if (access !== 'pending' && user.status !== 'active') {
      throw new ApiProblem(403, 'approval_pending', '관리자의 승인을 기다리는 중입니다');
    }
    if (access === 'admin' && user.role !== 'admin') throw new AdminRequiredError();

    request.user = user;
    return true;
  }

  private async authenticate(request: Request): Promise<UserView | null> {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      return this.tokens.authenticate(authorization.slice('Bearer '.length).trim());
    }

    const session: unknown = request.cookies?.[SESSION_COOKIE];
    if (typeof session !== 'string') return null;
    if (!SAFE_METHODS.has(request.method) && request.headers.origin !== this.config.appUrl) {
      throw new ApiProblem(403, 'csrf_rejected', '다른 사이트에서 보낸 요청은 받지 않습니다');
    }
    return this.sessions.authenticate(session);
  }
}
