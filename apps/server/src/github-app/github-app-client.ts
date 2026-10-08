/** GitHub App이 설치된 저장소 */
export interface AppRepository {
  /** GitHub 저장소 숫자 id. 저장소 이름이 바뀌어도 그대로다 */
  id: number;
  fullName: string;
  installationId: number;
}

export interface RepositoryFile {
  /** 파일 내용의 blob SHA. 바뀌었는지 볼 때 쓴다 */
  sha: string;
  size: number;
  /** UTF-8 내용. 1MB가 넘는 파일은 GitHub가 내용을 주지 않아 빈 문자열이다 */
  text: string;
}

/** App 설치가 없어졌거나 권한이 거부됨 (401·403·404) */
export class GitHubAppAccessError extends Error {
  constructor(message = 'GitHub App이 저장소에 접근하지 못했습니다. App 설치와 권한을 확인하세요') {
    super(message);
    this.name = 'GitHubAppAccessError';
  }
}

/**
 * .env.example을 읽는 GitHub App API (결정 73). 운영은 HttpGitHubAppClient, 테스트는 가짜 구현을 쓴다.
 * GitHub 장애(5xx)나 네트워크 오류는 GitHubUnavailableError다.
 */
export abstract class GitHubAppClient {
  abstract listRepositories(): Promise<AppRepository[]>;
  /** 기본 브랜치의 파일. 없으면 null */
  abstract readFile(
    installationId: number,
    repoFullName: string,
    path: string,
  ): Promise<RepositoryFile | null>;
}
