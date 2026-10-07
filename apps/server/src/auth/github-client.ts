export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

/** org 멤버십. 초대를 수락하지 않았으면 pending, 멤버가 아니면 none */
export type OrgMembership = 'active' | 'pending' | 'none';

/** OAuth code가 틀렸거나 만료됨, 또는 토큰이 거부됨 */
export class GitHubAuthError extends Error {
  constructor(message = 'GitHub 인증에 실패했습니다') {
    super(message);
    this.name = 'GitHubAuthError';
  }
}

/** GitHub 장애(5xx)나 네트워크 오류. 사용자 상태를 바꾸는 근거로 쓰지 않는다 */
export class GitHubUnavailableError extends Error {
  constructor(message = 'GitHub에 연결할 수 없습니다') {
    super(message);
    this.name = 'GitHubUnavailableError';
  }
}

/** GitHub API. 운영은 HttpGitHubClient, 테스트는 가짜 구현을 쓴다 */
export abstract class GitHubClient {
  /** OAuth 콜백의 code를 GitHub 사용자 토큰으로 바꾼다 */
  abstract exchangeCode(code: string, redirectUri: string): Promise<string>;
  abstract getUser(accessToken: string): Promise<GitHubUser>;
  abstract getOrgMembership(accessToken: string, org: string): Promise<OrgMembership>;
}
