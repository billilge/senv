import {
  GitHubAuthError,
  GitHubClient,
  GitHubUnavailableError,
  type GitHubUser,
  type OrgMembership,
} from '../auth/github-client.js';

/** 테스트용 GitHub. code 하나가 사용자 하나에 대응한다 */
export class FakeGitHubClient extends GitHubClient {
  private readonly users = new Map<string, GitHubUser>();
  private readonly memberships = new Map<number, OrgMembership>();
  unavailable = false;

  /** code로 로그인하면 이 사용자가 되도록 등록한다 */
  addUser(code: string, user: GitHubUser, membership: OrgMembership = 'active'): void {
    this.users.set(code, user);
    this.memberships.set(user.id, membership);
  }

  setMembership(userId: number, membership: OrgMembership): void {
    this.memberships.set(userId, membership);
  }

  async exchangeCode(code: string): Promise<string> {
    this.failIfUnavailable();
    if (!this.users.has(code)) throw new GitHubAuthError('잘못된 code');
    return `gho_${code}`;
  }

  async getUser(accessToken: string): Promise<GitHubUser> {
    this.failIfUnavailable();
    const user = this.users.get(accessToken.replace(/^gho_/, ''));
    if (!user) throw new GitHubAuthError('잘못된 토큰');
    return { ...user };
  }

  async getOrgMembership(accessToken: string): Promise<OrgMembership> {
    const user = await this.getUser(accessToken);
    return this.memberships.get(user.id) ?? 'none';
  }

  private failIfUnavailable(): void {
    if (this.unavailable) throw new GitHubUnavailableError();
  }
}
