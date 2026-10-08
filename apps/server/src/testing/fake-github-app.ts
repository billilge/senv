import { createHash } from 'node:crypto';
import { GitHubUnavailableError } from '../auth/github-client.js';
import {
  type AppRepository,
  GitHubAppAccessError,
  GitHubAppClient,
  type RepositoryFile,
} from '../github-app/github-app-client.js';

/** 테스트용 GitHub App. 설치된 저장소와 기본 브랜치의 파일을 메모리에 둔다 */
export class FakeGitHubAppClient extends GitHubAppClient {
  private readonly repositories: AppRepository[] = [];
  private readonly files = new Map<string, string>();
  /** 읽은 파일 (저장소:경로) */
  readonly reads: string[] = [];
  unavailable = false;
  denied = false;

  addRepository(repository: AppRepository): this {
    this.repositories.push(repository);
    return this;
  }

  /** 기본 브랜치의 파일을 바꾼다. null이면 지운다 */
  setFile(repoFullName: string, path: string, text: string | null): this {
    const name = `${repoFullName}:${path}`;
    if (text === null) this.files.delete(name);
    else this.files.set(name, text);
    return this;
  }

  async listRepositories(): Promise<AppRepository[]> {
    this.fail();
    return [...this.repositories];
  }

  async readFile(
    installationId: number,
    repoFullName: string,
    path: string,
  ): Promise<RepositoryFile | null> {
    this.fail();
    const installed = this.repositories.some(
      (repo) => repo.installationId === installationId && repo.fullName === repoFullName,
    );
    if (!installed) throw new GitHubAppAccessError();
    this.reads.push(`${repoFullName}:${path}`);
    const text = this.files.get(`${repoFullName}:${path}`);
    if (text === undefined) return null;
    return {
      sha: createHash('sha1').update(text).digest('hex'),
      size: Buffer.byteLength(text),
      text,
    };
  }

  private fail(): void {
    if (this.unavailable) throw new GitHubUnavailableError();
    if (this.denied) throw new GitHubAppAccessError();
  }
}
