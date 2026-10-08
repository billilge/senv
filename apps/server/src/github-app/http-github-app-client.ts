import { GitHubUnavailableError } from '../auth/github-client.js';
import type { GitHubAppConfig } from '../config/server-config.js';
import { createAppJwt } from './app-auth.js';
import {
  type AppRepository,
  GitHubAppAccessError,
  GitHubAppClient,
  type RepositoryFile,
} from './github-app-client.js';

const API = 'https://api.github.com';
const PAGE_SIZE = 100;

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/**
 * 실제 GitHub App 클라이언트. 테스트하지 않으므로 응답을 오류로 바꾸는 일만 한다.
 * App JWT로 설치 토큰을 받고, 설치 토큰은 만료 1분 전까지 메모리에 둔다.
 */
export class HttpGitHubAppClient extends GitHubAppClient {
  private readonly tokens = new Map<number, { token: string; expiresAt: number }>();

  constructor(
    private readonly config: GitHubAppConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  async listRepositories(): Promise<AppRepository[]> {
    const installations = (await this.json(
      `${API}/app/installations?per_page=${PAGE_SIZE}`,
      this.appJwt(),
    )) as { id: number }[];
    const repositories: AppRepository[] = [];
    for (const installation of installations) {
      const token = await this.installationToken(installation.id);
      for (let page = 1; ; page++) {
        const body = (await this.json(
          `${API}/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`,
          token,
        )) as { repositories: { id: number; full_name: string }[] };
        repositories.push(
          ...body.repositories.map((repo) => ({
            id: repo.id,
            fullName: repo.full_name,
            installationId: installation.id,
          })),
        );
        if (body.repositories.length < PAGE_SIZE) break;
      }
    }
    return repositories.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async readFile(
    installationId: number,
    repoFullName: string,
    path: string,
  ): Promise<RepositoryFile | null> {
    const token = await this.installationToken(installationId);
    // ref를 주지 않으면 기본 브랜치를 읽는다
    const response = await this.request(
      `${API}/repos/${encodePath(repoFullName)}/contents/${encodePath(path)}`,
      token,
    );
    if (response.status === 404) return null;
    this.failIfDenied(response);
    const body = (await response.json()) as {
      type?: string;
      sha: string;
      size: number;
      content?: string;
      encoding?: string;
      html_url: string;
    };
    if (body.type !== 'file') return null; // 폴더면 배열이 온다
    const text =
      body.encoding === 'base64' && body.content
        ? Buffer.from(body.content, 'base64').toString('utf8')
        : '';
    return { sha: body.sha, size: body.size, text, htmlUrl: body.html_url };
  }

  private appJwt(): string {
    return createAppJwt(this.config.appId, this.config.privateKey, this.now());
  }

  private async installationToken(installationId: number): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - 60_000 > this.now().getTime()) return cached.token;
    const response = await this.request(
      `${API}/app/installations/${installationId}/access_tokens`,
      this.appJwt(),
      'POST',
    );
    this.failIfDenied(response);
    const body = (await response.json()) as { token: string; expires_at: string };
    this.tokens.set(installationId, { token: body.token, expiresAt: Date.parse(body.expires_at) });
    return body.token;
  }

  private async json(url: string, token: string): Promise<unknown> {
    const response = await this.request(url, token);
    this.failIfDenied(response);
    return response.json();
  }

  private failIfDenied(response: Response): void {
    if (response.ok) return;
    if ([401, 403, 404].includes(response.status)) throw new GitHubAppAccessError();
    throw new GitHubUnavailableError(`GitHub가 ${response.status}로 응답했습니다`);
  }

  private async request(url: string, token: string, method = 'GET'): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'stream-env-control',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      throw new GitHubUnavailableError();
    }
    if (response.status >= 500) throw new GitHubUnavailableError();
    return response;
  }
}
