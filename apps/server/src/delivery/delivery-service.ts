import { type ReferenceIssue, resolveSharedReferences, SHARED_PROJECT_NAME } from '@senv/core';
import { ProjectNotFoundError } from '../projects/projects-service.js';
import type { CurrentValues, PublishService } from '../publishing/publish-service.js';

/** pull·run이 받는 값. 공유 참조는 실제 값으로 바뀌어 있다 */
export interface DeliveredValues {
  project: string;
  env: string;
  version: number;
  /** 해석에 쓴 공유 그룹 버전. 둘 중 하나만 바뀌어도 로컬 파일은 오래된 것이다 */
  sharedVersion: number;
  variables: Record<string, string>;
}

export class BrokenReferenceError extends Error {
  constructor(readonly issues: ReferenceIssue[]) {
    super(
      `해석할 수 없는 공유 참조가 있습니다: ${issues.map((i) => `${i.key} → ${i.reference}`).join(', ')}`,
    );
    this.name = 'BrokenReferenceError';
  }
}

export class DeliveryService {
  constructor(private readonly publishing: PublishService) {}

  /** 현재 값을 꺼내 공유 참조를 해석한다. 참조가 깨져 있으면 값을 돌려주지 않는다 */
  async resolve(project: string, env: string): Promise<DeliveredValues> {
    const current = await this.publishing.getCurrent(project, env);
    if (project === SHARED_PROJECT_NAME) {
      return { project, env, ...current, sharedVersion: current.version };
    }

    const shared = await this.sharedValues(env);
    const resolved = resolveSharedReferences(current.variables, shared.variables);
    if (resolved.issues.length > 0) throw new BrokenReferenceError(resolved.issues);

    return {
      project,
      env,
      version: current.version,
      sharedVersion: shared.version,
      variables: resolved.values,
    };
  }

  private async sharedValues(env: string): Promise<CurrentValues> {
    try {
      return await this.publishing.getCurrent(SHARED_PROJECT_NAME, env);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) return { version: 0, variables: {} };
      throw error;
    }
  }
}
