import { SenvApiError } from '@senv/api-client';
import type { CredentialStore, StoredCredentials } from './credentials.js';
import { withFileLock } from './file-lock.js';

export interface TokenPair {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

export class NotLoggedInError extends Error {
  constructor(reason = '로그인하지 않았습니다') {
    super(`${reason}. senv login으로 로그인하세요`);
    this.name = 'NotLoggedInError';
  }
}

export interface SessionOptions {
  apiUrl: string;
  store: CredentialStore;
  /** 서버에 refresh를 요청한다. 거부되면 SenvApiError(401)를 던진다 */
  refresh: (refreshToken: string) => Promise<TokenPair>;
  /** 여러 senv 프로세스가 동시에 갱신하지 않도록 잡는 잠금 파일 */
  lockPath: string;
  now?: () => Date;
}

/** 만료까지 이보다 적게 남으면 미리 갱신한다 */
const REFRESH_MARGIN_MS = 60_000;

/** 저장된 토큰을 꺼내 주고, 곧 만료되면 잠금을 잡고 갱신한다 */
export class CliSession {
  constructor(private readonly options: SessionOptions) {}

  async accessToken(): Promise<string> {
    const current = await this.load();
    if (this.isFresh(current)) return current.accessToken;

    // 서버는 이미 쓴 refresh 토큰이 다시 오면 토큰을 모두 폐기하므로, 갱신은 한 프로세스만 한다
    return withFileLock(this.options.lockPath, async () => {
      // 잠금을 기다리는 동안 다른 프로세스가 이미 갱신했을 수 있다
      const latest = await this.load();
      if (this.isFresh(latest)) return latest.accessToken;
      return this.refresh(latest);
    });
  }

  private async refresh(credentials: StoredCredentials): Promise<string> {
    const { apiUrl, store } = this.options;
    if (Date.parse(credentials.refreshExpiresAt) <= this.now().getTime()) {
      await store.clear(apiUrl);
      throw new NotLoggedInError('로그인이 만료되었습니다');
    }

    let pair: TokenPair;
    try {
      pair = await this.options.refresh(credentials.refreshToken);
    } catch (error) {
      if (error instanceof SenvApiError && error.status === 401) {
        await store.clear(apiUrl);
        throw new NotLoggedInError('로그인이 만료되었거나 폐기되었습니다');
      }
      throw error;
    }
    await store.save({ apiUrl, ...pair });
    return pair.accessToken;
  }

  private async load(): Promise<StoredCredentials> {
    const credentials = await this.options.store.load(this.options.apiUrl);
    if (!credentials) throw new NotLoggedInError();
    return credentials;
  }

  private isFresh(credentials: StoredCredentials): boolean {
    return Date.parse(credentials.accessExpiresAt) - this.now().getTime() > REFRESH_MARGIN_MS;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
