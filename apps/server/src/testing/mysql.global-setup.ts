import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MySqlContainer } from '@testcontainers/mysql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** 통합 테스트 전체에서 MySQL 컨테이너 하나를 띄우고 마이그레이션을 적용한다 */
export default async function setup(project: TestProject) {
  // 짧은 이름(mysql:8.4)은 Docker Desktop이 가끔 못 찾아 testcontainers가 내려받으려 한다(외부 접속).
  // 전체 이름으로 쓰면 로컬 이미지를 바로 찾는다
  const container = await new MySqlContainer('docker.io/library/mysql:8.4')
    .withDatabase('stream_env')
    .withUsername('stream_env')
    .withUserPassword('test-password')
    .start();
  const databaseUrl = container.getConnectionUri();

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    // e2e 패키지에서도 쓰므로 마이그레이션은 항상 서버 폴더(apps/server)에서 실행한다
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  project.provide('databaseUrl', databaseUrl);
  return async () => {
    await container.stop();
  };
}
