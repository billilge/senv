import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiExcludeEndpoint, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { SERVER_CONFIG } from '../app/app-dependencies.js';
import type { ServerConfig } from '../config/server-config.js';
import { AllowPending, Public, SESSION_COOKIE } from '../http/access.js';
import { AuthService, NotOrgMemberError, UserDisabledError } from './auth-service.js';
import { GitHubAuthError, GitHubUnavailableError } from './github-client.js';
import { SessionService } from './session-service.js';

const STATE_COOKIE = 'senv_oauth_state';
const NEXT_COOKIE = 'senv_oauth_next';
const LOGIN_FLOW_MS = 10 * 60 * 1000;

/** 로그인 실패를 브라우저에 /login?error=<code>로 알린다 */
const LOGIN_ERRORS: [new (...args: never[]) => Error, string][] = [
  [NotOrgMemberError, 'not_org_member'],
  [UserDisabledError, 'user_disabled'],
  [GitHubAuthError, 'github_auth_failed'],
  [GitHubUnavailableError, 'github_unavailable'],
];

/** 대시보드의 GitHub OAuth 로그인 (PRD 9.2) */
@ApiTags('auth')
@Controller()
export class WebAuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  @Get('auth/github')
  @Public()
  @ApiExcludeEndpoint()
  start(@Query('next') next: string | undefined, @Res() response: Response): void {
    const state = randomBytes(32).toString('base64url');
    const flowCookie: CookieOptions = { ...this.cookieBase(), maxAge: LOGIN_FLOW_MS };
    response.cookie(STATE_COOKIE, state, flowCookie);
    const path = safeRedirectPath(next);
    if (path) response.cookie(NEXT_COOKIE, path, flowCookie);
    else response.clearCookie(NEXT_COOKIE, this.cookieBase());

    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.searchParams.set('client_id', this.config.github.clientId);
    authorize.searchParams.set('redirect_uri', this.callbackUrl());
    authorize.searchParams.set('scope', 'read:user read:org');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('allow_signup', 'false');
    response.redirect(302, authorize.toString());
  }

  @Get('auth/github/callback')
  @Public()
  @ApiExcludeEndpoint()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const expected: unknown = request.cookies?.[STATE_COOKIE];
    const next = safeRedirectPath(request.cookies?.[NEXT_COOKIE]) ?? '/';
    response.clearCookie(STATE_COOKIE, this.cookieBase());
    response.clearCookie(NEXT_COOKIE, this.cookieBase());

    if (!code || !state || typeof expected !== 'string' || !sameSecret(state, expected)) {
      return response.redirect(302, '/login?error=invalid_state');
    }

    try {
      const user = await this.auth.loginWithGitHub(code, this.callbackUrl());
      const session = await this.sessions.create(user.id);
      response.cookie(SESSION_COOKIE, session.token, {
        ...this.cookieBase(),
        expires: session.expiresAt,
      });
      return response.redirect(302, next);
    } catch (error) {
      const failure = LOGIN_ERRORS.find(([type]) => error instanceof type);
      if (!failure) throw error;
      return response.redirect(302, `/login?error=${failure[1]}`);
    }
  }

  @Post('api/v1/auth/logout')
  @AllowPending()
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiResponse({ status: 204, description: '로그아웃됨' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token: unknown = request.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string') await this.sessions.revoke(token);
    response.clearCookie(SESSION_COOKIE, this.cookieBase());
  }

  private callbackUrl(): string {
    return `${this.config.appUrl}/auth/github/callback`;
  }

  /** HttpOnly·SameSite=Lax, https로 운영할 때는 Secure */
  private cookieBase(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.appUrl.startsWith('https://'),
      path: '/',
    };
  }
}

/** 같은 사이트 안의 경로만 돌아갈 곳으로 받는다 (오픈 리다이렉트 방지) */
function safeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 512) return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 줄바꿈 같은 제어 문자로 헤더를 깨뜨리지 못하게 막는다
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
