import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SenvApiError, unwrap } from '@senv/api-client';
import { type ChangeSet, createChangeSet, diffVariables, type EnvironmentName } from '@senv/core';
import type { CliContext } from '../context.js';
import { parseEnvFile } from '../files/env-file.js';
import { getDelivered, resolveTarget, type Target } from './target.js';

export class InvalidAssignmentError extends Error {
  constructor(readonly assignment: string) {
    super(`KEY=VALUE 형식이어야 합니다: ${assignment}`);
    this.name = 'InvalidAssignmentError';
  }
}

export class CancelledError extends Error {
  constructor() {
    super('취소했습니다. 게시하지 않았습니다');
    this.name = 'CancelledError';
  }
}

export class ConfirmationMismatchError extends Error {
  constructor(readonly project: string) {
    super(`프로젝트 이름이 ${project}와(과) 다릅니다. production에 게시하지 않았습니다`);
    this.name = 'ConfirmationMismatchError';
  }
}

export interface WriteOptions {
  env?: EnvironmentName;
  /** production이 아니면 확인을 묻지 않는다 */
  yes?: boolean;
  message?: string;
}

/** senv set KEY=VALUE…: 바뀐 키만 새 버전으로 게시한다 (PRD 6.2) */
export async function set(
  context: CliContext,
  assignments: string[],
  options: WriteOptions = {},
): Promise<void> {
  const values = Object.fromEntries(assignments.map(parseAssignment));
  const target = await resolveTarget(context, options.env);
  const current = await unwrap(
    context.api.GET('/api/v1/projects/{project}/envs/{env}', {
      params: { path: { project: target.config.project, env: target.env } },
    }),
  );
  const next = { ...current.variables, ...values };
  await publishChanges(context, target, {
    baseVersion: current.version,
    previous: current.variables,
    changes: createChangeSet(current.variables, next),
    options,
  });
}

/**
 * senv push: 로컬 파일을 서버 값(공유 참조를 푼 값)과 견줘, 달라진 키만 게시한다.
 * 같은 키는 보내지 않으므로 서버의 `${shared.KEY}` 참조가 실제 값으로 덮이지 않는다.
 * 파일에 없는 키는 --prune일 때만 지운다.
 */
export async function push(
  context: CliContext,
  options: WriteOptions & { file?: string; prune?: boolean } = {},
): Promise<void> {
  const target = await resolveTarget(context, options.env);
  const file = options.file ?? target.config.output;
  const local = parseEnvFile(target.config.format, await readFile(join(target.root, file), 'utf8'));
  const remote = await getDelivered(context, target);

  const setValues = Object.fromEntries(
    Object.entries(local).filter(([key, value]) => remote.variables[key] !== value),
  );
  const missing = Object.keys(remote.variables)
    .filter((key) => !Object.hasOwn(local, key))
    .sort();
  if (missing.length > 0 && !options.prune) {
    context.out.info(`${missing.join(', ')}: ${file}에 없지만 지우지 않습니다. 지우려면 --prune`);
  }
  const changes: ChangeSet = {
    ...(Object.keys(setValues).length > 0 && { set: setValues }),
    ...(options.prune && missing.length > 0 && { remove: missing }),
  };
  await publishChanges(context, target, {
    baseVersion: remote.version,
    previous: remote.variables,
    changes,
    options,
  });
}

function parseAssignment(assignment: string): [string, string] {
  const index = assignment.indexOf('=');
  if (index <= 0) throw new InvalidAssignmentError(assignment);
  return [assignment.slice(0, index), assignment.slice(index + 1)];
}

/**
 * 바뀐 키 이름을 보여주고 확인을 받은 뒤 게시한다 (PRD 6.3 쓰기 확인).
 * production은 --yes여도 프로젝트 이름을 다시 입력해야 한다.
 */
async function publishChanges(
  context: CliContext,
  target: Target,
  input: {
    baseVersion: number;
    previous: Record<string, string>;
    changes: ChangeSet;
    options: WriteOptions;
  },
): Promise<void> {
  const { project } = target.config;
  const label = `${project}/${target.env}`;
  const next = Object.fromEntries(
    Object.entries({ ...input.previous, ...input.changes.set }).filter(
      ([key]) => !input.changes.remove?.includes(key),
    ),
  );
  const diff = diffVariables(input.previous, next);
  if (diff.added.length + diff.changed.length + diff.removed.length === 0) {
    context.out.info(`${label}: 바뀐 값이 없습니다.`);
    return;
  }
  if (diff.changed.length > 0) context.out.info(`변경: ${diff.changed.join(', ')}`);
  if (diff.added.length > 0) context.out.info(`추가: ${diff.added.join(', ')}`);
  if (diff.removed.length > 0) context.out.info(`삭제: ${diff.removed.join(', ')}`);

  if (target.env === 'production') {
    const typed = await context.prompt.text(
      `production에 게시합니다. 확인하려면 프로젝트 이름(${project})을 입력하세요`,
    );
    if (typed.trim() !== project) throw new ConfirmationMismatchError(project);
  } else if (!input.options.yes) {
    if (!(await context.prompt.confirm(`${label}에 게시할까요?`))) throw new CancelledError();
  }

  const message = input.options.message?.trim();
  try {
    const result = await unwrap(
      context.api.POST('/api/v1/projects/{project}/envs/{env}/versions', {
        params: { path: { project, env: target.env } },
        body: {
          baseVersion: input.baseVersion,
          changes: input.changes,
          ...(message ? { message } : {}),
        },
      }),
    );
    context.out.info(`게시했습니다: ${label} v${result.version}`);
  } catch (error) {
    throw describePublishError(error);
  }
}

/** 422 검증 실패면 문제 목록을 메시지에 붙인다 */
function describePublishError(error: unknown): unknown {
  if (!(error instanceof SenvApiError) || error.code !== 'publish_validation') return error;
  const issues = Array.isArray(error.details?.issues) ? error.details.issues : [];
  const lines = issues.map(
    (issue: { key?: string; code?: string; reference?: string }) =>
      `- ${issue.key}: ${issue.code}${issue.reference ? ` (${issue.reference})` : ''}`,
  );
  return new Error([error.message, ...lines].join('\n'));
}
