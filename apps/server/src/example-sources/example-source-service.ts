import { posix } from 'node:path';
import {
  diffKeyNames,
  parseEnvExample,
  planExampleImport,
  type SkippedExampleLine,
} from '@senv/core';
import { GitHubUnavailableError } from '../auth/github-client.js';
import { withNamedLock } from '../database/named-lock.js';
import type {
  ExampleSource,
  ExampleSourceResult,
  PrismaClient,
} from '../generated/prisma/client.js';
import {
  type AppRepository,
  GitHubAppAccessError,
  type GitHubAppClient,
} from '../github-app/github-app-client.js';
import type { KeySchemaService } from '../key-schemas/key-schema-service.js';
import { ProjectNotFoundError } from '../projects/projects-service.js';

/** 이보다 큰 예시 파일은 읽지 않는다 */
const MAX_EXAMPLE_BYTES = 64 * 1024;
/** 같은 연결의 확인이 겹치면 앞의 확인이 끝날 때까지 기다린다 */
const CHECK_WAIT_SECONDS = 10;
const MAX_PATH_LENGTH = 512;

/** 프로젝트에 연결한 .env.example과 마지막으로 읽은 결과 (PRD 결정 73~76) */
export interface ExampleSourceView {
  repoId: number;
  repoFullName: string;
  path: string;
  /** GitHub 기본 브랜치에서 파일을 보는 주소 */
  fileUrl: string;
  lastResult: ExampleSourceResult | null;
  lastMessage: string | null;
  lastCheckedAt: Date | null;
  /** 마지막으로 읽은 예시의 키 (이름 순) */
  keys: string[];
  /** 파일이 마지막으로 바뀌었을 때 키 스키마에 새로 등록한 키 */
  lastAdded: string[];
  /** 파일이 마지막으로 바뀌었을 때 예시에서 빠진 키. 키 스키마에서 지우지는 않는다 */
  lastRemoved: string[];
  skipped: SkippedExampleLine[];
}

/** GitHub push 웹훅에서 쓰는 부분 */
export interface PushEvent {
  ref: string;
  repository: { id: number; fullName: string; defaultBranch: string };
  installationId: number | null;
  /** 푸시한 GitHub 사용자 */
  sender: string;
}

export class GitHubAppDisabledError extends Error {
  constructor() {
    super('GitHub App이 설정되지 않아 .env.example 연결을 쓸 수 없습니다');
    this.name = 'GitHubAppDisabledError';
  }
}

export class ExampleSourceNotFoundError extends Error {
  constructor(readonly project: string) {
    super(`${project}에 연결된 .env.example이 없습니다`);
    this.name = 'ExampleSourceNotFoundError';
  }
}

export class InvalidExamplePathError extends Error {
  constructor() {
    super('경로는 저장소 루트 기준 파일 경로여야 합니다 (예: apps/web/.env.example)');
    this.name = 'InvalidExamplePathError';
  }
}

export class SharedGroupNoExampleError extends Error {
  constructor() {
    super('공유 그룹에는 .env.example을 연결하지 않습니다. 그 값을 쓰는 프로젝트에 연결하세요');
    this.name = 'SharedGroupNoExampleError';
  }
}

export class RepositoryNotInstalledError extends Error {
  constructor() {
    super('GitHub App이 설치된 저장소가 아닙니다. 저장소에 App을 설치하세요');
    this.name = 'RepositoryNotInstalledError';
  }
}

export class ExampleFileNotFoundError extends Error {
  constructor(readonly path: string) {
    super(`저장소 기본 브랜치에 ${path}이(가) 없습니다`);
    this.name = 'ExampleFileNotFoundError';
  }
}

const splitList = (value: string | null) => (value ?? '').split(',').filter(Boolean);

function toView(row: ExampleSource): ExampleSourceView {
  return {
    repoId: Number(row.repoId),
    repoFullName: row.repoFullName,
    path: row.path,
    fileUrl: `https://github.com/${row.repoFullName}/blob/HEAD/${row.path}`,
    lastResult: row.lastResult,
    lastMessage: row.lastMessage,
    lastCheckedAt: row.lastCheckedAt,
    keys: splitList(row.lastKeys).sort(),
    lastAdded: splitList(row.lastAdded),
    lastRemoved: splitList(row.lastRemoved),
    skipped: row.lastSkipped ? (JSON.parse(row.lastSkipped) as SkippedExampleLine[]) : [],
  };
}

/** 앞의 `/`·`./`를 떼고, 폴더 밖이나 폴더를 가리키는 경로는 막는다 */
function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/, '');
  if (trimmed === '' || trimmed.endsWith('/') || trimmed.includes('\\')) {
    throw new InvalidExamplePathError();
  }
  const normalized = posix.normalize(trimmed);
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.length > MAX_PATH_LENGTH
  ) {
    throw new InvalidExamplePathError();
  }
  return normalized;
}

/**
 * GitHub 저장소의 .env.example을 키 스키마에 반영한다 (M1.2, PRD 결정 73~76).
 * 언제나 기본 브랜치의 지금 파일을 읽고, 스키마에 없는 키만 선택 키로 등록한다. 값은 남기지 않는다.
 * GitHub App 설정이 없으면(github가 null) 연결·확인은 GitHubAppDisabledError다.
 */
export class ExampleSourceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly keySchemas: KeySchemaService,
    private readonly github: GitHubAppClient | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get enabled(): boolean {
    return this.github !== null;
  }

  async get(project: string): Promise<ExampleSourceView | null> {
    const row = await this.prisma.project.findUnique({
      where: { name: project },
      select: { exampleSource: true },
    });
    if (!row) throw new ProjectNotFoundError(project);
    return row.exampleSource ? toView(row.exampleSource) : null;
  }

  listRepositories(): Promise<AppRepository[]> {
    return this.requireGitHub().listRepositories();
  }

  /** 프로젝트에 예시 파일을 연결(또는 바꾸기)하고 바로 한 번 읽는다 */
  async link(
    project: string,
    input: { repoId: number; path: string },
    actor: string,
  ): Promise<ExampleSourceView> {
    const github = this.requireGitHub();
    const path = normalizePath(input.path);
    const row = await this.prisma.project.findUnique({
      where: { name: project },
      select: { id: true, kind: true },
    });
    if (!row) throw new ProjectNotFoundError(project);
    if (row.kind === 'shared') throw new SharedGroupNoExampleError();

    const repo = (await github.listRepositories()).find((entry) => entry.id === input.repoId);
    if (!repo) throw new RepositoryNotInstalledError();
    if (!(await github.readFile(repo.installationId, repo.fullName, path))) {
      throw new ExampleFileNotFoundError(path);
    }

    const now = this.now();
    // 연결을 바꾸면 이전 파일의 기록을 지우고 처음부터 읽는다
    const fields = {
      installationId: BigInt(repo.installationId),
      repoId: BigInt(repo.id),
      repoFullName: repo.fullName,
      path,
      lastBlobSha: null,
      lastKeys: null,
      lastAdded: null,
      lastRemoved: null,
      lastSkipped: null,
      lastResult: null,
      lastMessage: null,
      lastCheckedAt: null,
      updatedAt: now,
    };
    const source = await this.prisma.exampleSource.upsert({
      where: { projectId: row.id },
      create: { projectId: row.id, createdBy: actor, createdAt: now, ...fields },
      update: fields,
    });
    await this.checkLocked(source.id, project, actor);
    return (await this.get(project)) as ExampleSourceView;
  }

  /** 지금 확인 */
  async check(project: string, actor: string): Promise<ExampleSourceView> {
    this.requireGitHub();
    const source = await this.findSource(project);
    await this.checkLocked(source.id, project, actor);
    return (await this.get(project)) as ExampleSourceView;
  }

  /** 기본 브랜치 푸시면 그 저장소에 연결된 프로젝트를 모두 확인하고, 확인한 연결 수를 돌려준다 */
  async handlePush(event: PushEvent): Promise<number> {
    this.requireGitHub();
    if (event.ref !== `refs/heads/${event.repository.defaultBranch}`) return 0;
    const sources = await this.prisma.exampleSource.findMany({
      where: { repoId: BigInt(event.repository.id) },
      select: { id: true, repoFullName: true, installationId: true, project: true },
    });
    for (const source of sources) {
      const installationId = event.installationId ?? Number(source.installationId);
      if (
        source.repoFullName !== event.repository.fullName ||
        Number(source.installationId) !== installationId
      ) {
        await this.prisma.exampleSource.update({
          where: { id: source.id },
          data: {
            repoFullName: event.repository.fullName,
            installationId: BigInt(installationId),
            updatedAt: this.now(),
          },
        });
      }
      await this.checkLocked(source.id, source.project.name, `github:${event.sender}`);
    }
    return sources.length;
  }

  /** 연결을 끊는다. 등록된 키는 남는다 */
  async unlink(project: string): Promise<void> {
    const { count } = await this.prisma.exampleSource.deleteMany({
      where: { project: { name: project } },
    });
    if (count === 0) {
      await this.get(project); // 프로젝트가 없으면 ProjectNotFoundError
      throw new ExampleSourceNotFoundError(project);
    }
  }

  private requireGitHub(): GitHubAppClient {
    if (!this.github) throw new GitHubAppDisabledError();
    return this.github;
  }

  private async findSource(project: string): Promise<ExampleSource> {
    const row = await this.prisma.project.findUnique({
      where: { name: project },
      select: { exampleSource: true },
    });
    if (!row) throw new ProjectNotFoundError(project);
    if (!row.exampleSource) throw new ExampleSourceNotFoundError(project);
    return row.exampleSource;
  }

  /** 같은 연결의 확인은 하나씩 한다. 겹치면 앞의 확인이 끝난 뒤 다시 읽는다 */
  private async checkLocked(sourceId: string, project: string, actor: string): Promise<void> {
    await withNamedLock(
      this.prisma,
      `senv:example-source:${sourceId}`,
      () => this.read(sourceId, project, actor),
      { waitSeconds: CHECK_WAIT_SECONDS },
    );
  }

  private async read(sourceId: string, project: string, actor: string): Promise<void> {
    const github = this.requireGitHub();
    const source = await this.prisma.exampleSource.findUniqueOrThrow({ where: { id: sourceId } });
    const record = (lastResult: ExampleSourceResult, lastMessage: string | null) =>
      this.prisma.exampleSource.update({
        where: { id: sourceId },
        data: { lastResult, lastMessage, lastCheckedAt: this.now(), updatedAt: this.now() },
      });

    let file: Awaited<ReturnType<GitHubAppClient['readFile']>>;
    try {
      file = await github.readFile(Number(source.installationId), source.repoFullName, source.path);
    } catch (error) {
      if (error instanceof GitHubAppAccessError) {
        await record('no_access', error.message);
        return;
      }
      if (error instanceof GitHubUnavailableError) {
        await record('error', error.message);
        return;
      }
      throw error;
    }
    if (!file) {
      await record('not_found', `저장소 기본 브랜치에 ${source.path}이(가) 없습니다`);
      return;
    }
    if (file.size > MAX_EXAMPLE_BYTES) {
      await record('too_large', '64KB가 넘는 파일은 읽지 않습니다');
      return;
    }
    // 파일이 그대로면 다시 등록하지 않고, 마지막 변경의 결과(등록·빠진 키)를 남겨 둔다
    if (file.sha === source.lastBlobSha) {
      await record('ok', null);
      return;
    }

    const parsed = parseEnvExample(file.text);
    const schema = await this.keySchemas.get(project);
    const added = await this.keySchemas.addMissing(
      project,
      planExampleImport(parsed.entries, schema.keys, schema.publicPrefixes),
      actor,
    );
    const keys = parsed.entries.map((entry) => entry.key);
    const { removed } = diffKeyNames(splitList(source.lastKeys), keys);
    await this.prisma.exampleSource.update({
      where: { id: sourceId },
      data: {
        lastResult: 'ok',
        lastMessage: null,
        lastBlobSha: file.sha,
        lastKeys: keys.join(','),
        lastAdded: added.join(','),
        lastRemoved: removed.join(','),
        lastSkipped: JSON.stringify(parsed.skipped),
        lastCheckedAt: this.now(),
        updatedAt: this.now(),
      },
    });
  }
}
