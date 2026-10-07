import {
  GitHubAuthError,
  GitHubClient,
  GitHubUnavailableError,
  type GitHubUser,
  type OrgMembership,
} from './github-client.js';

const API = 'https://api.github.com';

/**
 * 실제 GitHub API 클라이언트. 테스트하지 않으므로 응답을 오류로 바꾸는 일만 한다.
 * - 5xx, 네트워크 오류 → GitHubUnavailableError (사용자 상태를 바꾸는 근거로 쓰지 않는다)
 * - 401 → GitHubAuthError
 * - 멤버십 403 → GitHubAuthError (org가 이 OAuth App을 승인하지 않았을 때 흔하다)
 * - 멤버십 404 → none
 */
export class HttpGitHubClient extends GitHubClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {
    super();
  }

  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const response = await this.request('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const body = (await response.json()) as { access_token?: string; error?: string };
    if (!body.access_token)
      throw new GitHubAuthError(`GitHub 로그인 실패: ${body.error ?? 'unknown'}`);
    return body.access_token;
  }

  async getUser(accessToken: string): Promise<GitHubUser> {
    const response = await this.request(`${API}/user`, {}, accessToken);
    if (response.status === 401) throw new GitHubAuthError();
    const body = (await response.json()) as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string | null;
    };
    return { id: body.id, login: body.login, name: body.name, avatarUrl: body.avatar_url };
  }

  async getOrgMembership(accessToken: string, org: string): Promise<OrgMembership> {
    const url = `${API}/user/memberships/orgs/${encodeURIComponent(org)}`;
    const response = await this.request(url, {}, accessToken);
    if (response.status === 404) return 'none';
    if (response.status === 401) throw new GitHubAuthError();
    if (response.status === 403) {
      throw new GitHubAuthError(`${org} 조직이 이 OAuth App을 승인했는지 확인하세요`);
    }
    const body = (await response.json()) as { state?: string };
    return body.state === 'active' ? 'active' : 'pending';
  }

  private async request(url: string, init: RequestInit, accessToken?: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'stream-env-control',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new GitHubUnavailableError();
    }
    if (response.status >= 500) throw new GitHubUnavailableError();
    return response;
  }
}
