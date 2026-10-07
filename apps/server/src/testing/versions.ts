import { type EnvironmentName, SHARED_PROJECT_NAME } from '@senv/core';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { SnapshotService } from '../snapshots/snapshot-service.js';

/**
 * 게시 검증을 거치지 않고 특정 버전을 현재 버전으로 만든다.
 * 동시 게시 등으로 이미 참조가 깨진 상태를 재현할 때만 쓴다.
 */
export async function forceCurrentVersion(
  prisma: PrismaClient,
  snapshots: SnapshotService,
  target: { project: string; env: EnvironmentName; version: number },
  variables: Record<string, string>,
): Promise<void> {
  const { project, env, version } = target;
  const ref =
    project === SHARED_PROJECT_NAME
      ? ({ scope: 'shared', env, version } as const)
      : ({ scope: 'project', project, env, version } as const);
  await snapshots.save(ref, {
    createdAt: new Date(0).toISOString(),
    createdBy: 'test',
    message: '',
    variables,
  });
  await prisma.environment.updateMany({
    where: { name: env, project: { name: project } },
    data: { currentVersion: version },
  });
}
