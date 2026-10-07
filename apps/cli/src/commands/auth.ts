import { SenvApiError, unwrap } from '@senv/api-client';
import { FileCredentialStore } from '../auth/credentials.js';
import type { CliContext } from '../context.js';

export class LoginFailedError extends Error {
  constructor(reason: string) {
    super(`로그인하지 못했습니다: ${reason}`);
    this.name = 'LoginFailedError';
  }
}

/** senv login: 디바이스 로그인 (브라우저에서 GitHub 로그인 후 코드 승인, PRD 9.2) */
export async function login(
  context: CliContext,
  options: { browser?: boolean } = {},
): Promise<void> {
  const { out } = context;
  const started = await unwrap(context.anonymousApi.POST('/api/v1/auth/device'));

  out.info(
    `브라우저에서 아래 코드를 확인하고 승인하세요.\n  코드: ${started.userCode}\n  주소: ${started.verificationUriComplete}`,
  );
  if (options.browser !== false) {
    await context.openBrowser(started.verificationUriComplete).catch(() => {
      out.warn(
        `브라우저를 열 수 없습니다. 이 주소를 직접 여세요: ${started.verificationUriComplete}`,
      );
    });
  }

  let interval = started.interval;
  for (;;) {
    await context.sleep(interval * 1000);
    try {
      const pair = await unwrap(
        context.anonymousApi.POST('/api/v1/auth/device/token', {
          body: { deviceCode: started.deviceCode },
        }),
      );
      await context.credentials.save({ apiUrl: context.apiUrl, ...pair });
      if (context.credentials instanceof FileCredentialStore) {
        out.warn(
          `OS 키체인을 쓸 수 없어 토큰을 ${context.credentials.path}에 저장했습니다 (권한 600).`,
        );
      }
      const me = await unwrap(context.api.GET('/api/v1/me'));
      out.info(`${me.login}(으)로 로그인했습니다.`);
      return;
    } catch (error) {
      if (!(error instanceof SenvApiError)) throw error;
      if (error.code === 'authorization_pending') continue;
      if (error.code === 'slow_down') {
        const next = error.details?.interval;
        interval = typeof next === 'number' ? next : interval + 5;
        continue;
      }
      if (error.code === 'access_denied') throw new LoginFailedError('브라우저에서 거절했습니다');
      if (error.code === 'expired_token') throw new LoginFailedError('코드가 만료되었습니다');
      throw error;
    }
  }
}

/** senv logout: 서버에 토큰 폐기를 요청하고 저장된 토큰을 지운다 */
export async function logout(context: CliContext): Promise<void> {
  const { out, credentials, apiUrl } = context;
  const stored = await credentials.load(apiUrl);
  if (!stored) {
    out.info('로그인되어 있지 않습니다.');
    return;
  }

  try {
    for (const token of [stored.refreshToken, stored.accessToken]) {
      await unwrap(context.anonymousApi.POST('/api/v1/auth/token/revoke', { body: { token } }));
    }
  } catch {
    // 서버에 닿지 못해도 이 기기에서는 로그아웃한다. 토큰은 만료되면 쓸 수 없게 된다
    out.warn('서버에 토큰 폐기를 알리지 못했습니다. 이 기기의 토큰은 지웠습니다.');
  }
  await credentials.clear(apiUrl);
  out.info('로그아웃했습니다.');
}

/** senv whoami: 로그인한 사용자를 보여준다 */
export async function whoami(context: CliContext): Promise<void> {
  const me = await unwrap(context.api.GET('/api/v1/me'));
  context.out.result(
    `${me.login} (${me.role === 'admin' ? '관리자' : '멤버'}) @ ${context.apiUrl}`,
  );
  if (me.status === 'pending') {
    context.out.warn('관리자의 승인을 기다리는 중입니다. 승인 전에는 값을 받을 수 없습니다.');
  }
}
