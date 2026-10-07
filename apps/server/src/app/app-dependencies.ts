import type { GitHubClient } from '../auth/github-client.js';
import type { ServerConfig } from '../config/server-config.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { SnapshotStore } from '../storage/snapshot-store.js';

/** 앱이 바깥에서 받는 것들. 운영은 main.ts가, 테스트는 테스트용 구현을 넣는다 */
export interface AppDependencies {
  config: ServerConfig;
  prisma: PrismaClient;
  snapshotStore: SnapshotStore;
  github: GitHubClient;
  now?: () => Date;
  /** 대시보드 빌드 결과(index.html, assets/) 폴더. 없으면 API만 연다 */
  dashboardDir?: string;
}

export const SERVER_CONFIG = Symbol('SERVER_CONFIG');
export const CLOCK = Symbol('CLOCK');
