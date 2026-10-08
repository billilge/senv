import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserView } from '../auth/auth-service.js';

/**
 * 경로별 접근 수준. 표시가 없으면 active(승인된 사용자)다.
 * - public: 인증 없이
 * - pending: 승인 대기 사용자도 (예: /me)
 * - active: 승인된 사용자
 * - admin: 활성 관리자
 */
export type AccessLevel = 'public' | 'pending' | 'active' | 'admin';

export const ACCESS_KEY = 'senv:access';
export const SESSION_COOKIE = 'senv_session';

export const VIA_KEY = 'senv:via';

/** CLI 토큰(Bearer)으로 온 요청만 받는다. 대시보드 세션이 탈취돼도 부를 수 없게 하는 경로에 붙인다 (결정 61) */
export const CliTokenOnly = () => SetMetadata(VIA_KEY, 'token');

export const Public = () => SetMetadata(ACCESS_KEY, 'public' satisfies AccessLevel);
export const AllowPending = () => SetMetadata(ACCESS_KEY, 'pending' satisfies AccessLevel);
export const AdminOnly = () => SetMetadata(ACCESS_KEY, 'admin' satisfies AccessLevel);

/** AuthGuard가 확인한 현재 사용자 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserView =>
    context.switchToHttp().getRequest<{ user: UserView }>().user,
);
