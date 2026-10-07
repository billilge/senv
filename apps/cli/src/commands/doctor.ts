import { unwrap } from '@senv/api-client';
import { validateEnvironment } from '@senv/core';
import { NotLoggedInError } from '../auth/session.js';
import { InvalidProjectConfigError, ProjectConfigNotFoundError } from '../config/project-config.js';
import type { CliContext } from '../context.js';
import { isGitIgnored } from '../files/gitignore.js';
import { getDelivered, resolveTarget, type Target } from './target.js';

/**
 * senv doctor: 설정, 로그인, .gitignore, 필수 키·타입, 클라이언트 노출을 점검한다 (PRD 6.2).
 * 문제(✗)가 하나라도 있으면 1을 돌려준다. 경고(⚠)는 종료 코드에 영향을 주지 않는다.
 */
export async function doctor(context: CliContext): Promise<number> {
  let problems = 0;
  const ok = (message: string) => context.out.info(`✓ ${message}`);
  const warn = (message: string) => context.out.info(`⚠ ${message}`);
  const fail = (message: string) => {
    problems++;
    context.out.info(`✗ ${message}`);
  };

  let target: Target;
  try {
    target = await resolveTarget(context);
  } catch (error) {
    if (error instanceof ProjectConfigNotFoundError || error instanceof InvalidProjectConfigError) {
      fail(`senv.json: ${error.message}`);
      return 1;
    }
    throw error;
  }
  const { project, output } = target.config;
  ok(`senv.json: ${project} (기본 환경 ${target.env}, 출력 ${output})`);

  try {
    const me = await unwrap(context.api.GET('/api/v1/me'));
    ok(`로그인: ${me.login}`);
  } catch (error) {
    if (error instanceof NotLoggedInError) {
      fail('로그인: 로그인하지 않았습니다. senv login을 실행하세요');
      return 1;
    }
    throw error;
  }

  if (await isGitIgnored(target.root, output)) ok(`.gitignore: ${output}은(는) 커밋되지 않습니다`);
  else fail(`.gitignore: ${output}이(가) git에서 무시되지 않습니다. .gitignore에 추가하세요`);

  const [schema, delivered] = await Promise.all([
    unwrap(context.api.GET('/api/v1/projects/{project}/schema', { params: { path: { project } } })),
    getDelivered(context, target),
  ]);
  const issues = validateEnvironment(schema.keys, delivered.variables, target.env).filter(
    (issue) => issue.severity === 'error',
  );
  if (issues.length === 0) ok(`키 검사: ${project}/${target.env} v${delivered.version}`);
  for (const issue of issues) {
    if (issue.code === 'missing_required') {
      fail(`${issue.key}: 필수 키인데 ${target.env}에 값이 없습니다`);
    } else if (issue.code === 'invalid_type') {
      fail(`${issue.key}: ${issue.expected} 형식이 아닙니다`);
    }
  }

  const exposure = delivered.exposure ?? { exposedSecrets: [], unregistered: [] };
  for (const key of exposure.exposedSecrets) {
    fail(`${key}: secret인데 클라이언트 번들에 들어가는 이름입니다`);
  }
  for (const key of exposure.unregistered) {
    warn(`${key}: 클라이언트 번들에 들어가는 이름인데 키 스키마에 없습니다`);
  }

  return problems > 0 ? 1 : 0;
}
