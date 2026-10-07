import {
  applyChangeSet,
  type ChangeSet,
  diffVariables,
  type EnvironmentName,
  hasChanges,
  isEnvironmentName,
  isValidKeyName,
  type ReferenceIssue,
  resolveSharedReferences,
  SHARED_PROJECT_NAME,
  type VariableDiff,
} from '@senv/core';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectNotFoundError } from '../projects/projects-service.js';
import type { SnapshotService } from '../snapshots/snapshot-service.js';
import type { SnapshotRef } from '../storage/snapshot-store.js';

export interface PublishInput {
  project: string;
  env: string;
  /** 요청한 사람이 보고 있던 버전. 그 사이 다른 게시가 있었으면 충돌이다 */
  baseVersion: number;
  changes: ChangeSet;
  message?: string;
  /** 게시한 사용자 또는 토큰 식별자 */
  actor: string;
}

export interface PublishResult {
  version: number;
  diff: VariableDiff;
}

export interface CurrentValues {
  version: number;
  variables: Record<string, string>;
}

export type PublishIssue =
  | { code: 'invalid_key_name'; key: string }
  | { code: 'reference_in_shared_group'; key: string }
  | ReferenceIssue;

export class InvalidEnvironmentError extends Error {
  constructor(readonly env: string) {
    super(`환경은 local, development, production 중 하나여야 합니다: ${JSON.stringify(env)}`);
    this.name = 'InvalidEnvironmentError';
  }
}

export class VersionConflictError extends Error {
  constructor(
    readonly baseVersion: number,
    readonly currentVersion: number,
  ) {
    super(`그 사이 다른 게시가 있었습니다 (기준 v${baseVersion}, 현재 v${currentVersion})`);
    this.name = 'VersionConflictError';
  }
}

export class NoChangesError extends Error {
  constructor() {
    super('바뀐 값이 없습니다');
    this.name = 'NoChangesError';
  }
}

export class PublishValidationError extends Error {
  constructor(readonly issues: PublishIssue[]) {
    super(`게시할 수 없습니다: 문제 ${issues.length}건`);
    this.name = 'PublishValidationError';
  }
}

/** 게시 대상 환경. 공유 그룹은 kind='shared'인 프로젝트다 */
interface Target {
  environmentId: string;
  project: string;
  kind: 'app' | 'shared';
  env: EnvironmentName;
  currentVersion: number;
}

export class PublishService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly snapshots: SnapshotService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * 환경 행을 잠그고 기준 버전을 확인한 뒤, 변경을 적용한 새 버전을 저장한다 (PRD 4.7).
   * 스냅샷은 저장했는데 DB 기록이 실패하면 그 스냅샷을 지운다.
   */
  async publish(input: PublishInput): Promise<PublishResult> {
    const target = await this.findTarget(input.project, input.env);
    const message = input.message ?? '';
    let saved: SnapshotRef | undefined;

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const [locked] = await tx.$queryRaw<{ current_version: number }[]>`
            SELECT current_version FROM environments WHERE id = ${target.environmentId} FOR UPDATE`;
          const currentVersion = Number(locked?.current_version);
          if (currentVersion !== input.baseVersion) {
            throw new VersionConflictError(input.baseVersion, currentVersion);
          }

          const current = await this.loadVariables(target, currentVersion);
          const next = applyChangeSet(current, input.changes);
          const diff = diffVariables(current, next);
          if (!hasChanges(diff)) throw new NoChangesError();

          const issues = await this.validate(target, next);
          if (issues.length > 0) throw new PublishValidationError(issues);

          const version = currentVersion + 1;
          const ref = refFor(target, version);
          const createdAt = this.now();
          await this.snapshots.save(ref, {
            createdAt: createdAt.toISOString(),
            createdBy: input.actor,
            message,
            variables: next,
          });
          saved = ref;

          await tx.environmentVersion.create({
            data: {
              environmentId: target.environmentId,
              version,
              createdBy: input.actor,
              message,
              createdAt,
            },
          });
          await tx.environment.update({
            where: { id: target.environmentId },
            data: { currentVersion: version },
          });
          return { version, diff };
        },
        // 트랜잭션 안에서 R2에 쓰므로 기본값(5초)보다 여유를 둔다
        { timeout: 20_000 },
      );
    } catch (error) {
      // 지우기마저 실패해 남은 객체는 아무도 가리키지 않고, 다음 게시가 같은 키로 덮어쓴다
      if (saved) await this.snapshots.remove(saved).catch(() => undefined);
      throw error;
    }
  }

  async getCurrent(project: string, env: string): Promise<CurrentValues> {
    const target = await this.findTarget(project, env);
    return {
      version: target.currentVersion,
      variables: await this.loadVariables(target, target.currentVersion),
    };
  }

  private async findTarget(project: string, env: string): Promise<Target> {
    if (!isEnvironmentName(env)) throw new InvalidEnvironmentError(env);
    const row = await this.prisma.environment.findFirst({
      where: { name: env, project: { name: project } },
      select: { id: true, currentVersion: true, project: { select: { kind: true } } },
    });
    if (!row) throw new ProjectNotFoundError(project);
    return {
      environmentId: row.id,
      project,
      kind: row.project.kind,
      env,
      currentVersion: row.currentVersion,
    };
  }

  private async loadVariables(target: Target, version: number): Promise<Record<string, string>> {
    if (version === 0) return {};
    return (await this.snapshots.load(refFor(target, version))).variables;
  }

  /** 키 이름 규칙과 공유 참조를 검사한다. 공유 그룹 값 안에는 참조를 쓸 수 없다 */
  private async validate(target: Target, next: Record<string, string>): Promise<PublishIssue[]> {
    const issues: PublishIssue[] = Object.keys(next)
      .filter((key) => !isValidKeyName(key))
      .sort()
      .map((key) => ({ code: 'invalid_key_name', key }));

    if (target.kind === 'shared') {
      // 빈 공유 그룹으로 해석하면 모든 참조가 이슈로 잡힌다
      const keys = new Set(resolveSharedReferences(next, {}).issues.map((issue) => issue.key));
      for (const key of keys) issues.push({ code: 'reference_in_shared_group', key });
    } else {
      issues.push(...resolveSharedReferences(next, await this.sharedVariables(target.env)).issues);
    }
    return issues;
  }

  private async sharedVariables(env: EnvironmentName): Promise<Record<string, string>> {
    try {
      const shared = await this.findTarget(SHARED_PROJECT_NAME, env);
      return await this.loadVariables(shared, shared.currentVersion);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) return {};
      throw error;
    }
  }
}

function refFor(target: Target, version: number): SnapshotRef {
  return target.kind === 'shared'
    ? { scope: 'shared', env: target.env, version }
    : { scope: 'project', project: target.project, env: target.env, version };
}
