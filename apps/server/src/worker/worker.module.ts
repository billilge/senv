import { type DynamicModule, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { createCoolifyProvider } from '@senv/target-coolify';
import type { Keyring } from '../crypto/envelope.js';
import { DeliveryService } from '../delivery/delivery-service.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { JobsService } from '../jobs/jobs-service.js';
import { KeySchemaService } from '../key-schemas/key-schema-service.js';
import { CleanupService } from '../maintenance/cleanup-service.js';
import { PublishService } from '../publishing/publish-service.js';
import { SnapshotService } from '../snapshots/snapshot-service.js';
import type { SnapshotStore } from '../storage/snapshot-store.js';
import { ConnectionsService } from '../targets/connections-service.js';
import { MappingsService } from '../targets/mappings-service.js';
import { SyncService } from '../targets/sync-service.js';
import { type AnyProvider, TargetRegistry } from '../targets/target-registry.js';
import { CleanupTask } from './cleanup.task.js';
import { DriftTask } from './drift.task.js';
import { SyncJobTask } from './sync-job.task.js';

export interface WorkerDependencies {
  prisma: PrismaClient;
  snapshotStore: SnapshotStore;
  keyring: Keyring;
  /** 배포 대상 제공자. 기본은 Coolify, 테스트는 메모리 제공자 */
  targetProviders?: AnyProvider[];
  now?: () => Date;
}

/**
 * 예약 작업을 돌리는 worker. HTTP는 열지 않는다.
 * 만료 기록 정리, 배포 대상 동기화 작업 처리, 드리프트 점검 (결정 33, 53, 54)
 */
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest 동적 모듈은 static register()를 가진 클래스로 만든다
export class WorkerModule {
  static register(deps: WorkerDependencies): DynamicModule {
    const now = deps.now ?? (() => new Date());
    const registry = new TargetRegistry(deps.targetProviders ?? [createCoolifyProvider()]);
    const prisma = deps.prisma;
    const publishing = new PublishService(
      prisma,
      new SnapshotService(deps.snapshotStore, deps.keyring),
      now,
    );
    const schemas = new KeySchemaService(prisma, now);
    const connections = new ConnectionsService(prisma, registry, deps.keyring, now);
    return {
      module: WorkerModule,
      imports: [ScheduleModule.forRoot()],
      providers: [
        { provide: PrismaClient, useValue: prisma },
        { provide: CleanupService, useValue: new CleanupService(prisma, deps.now) },
        { provide: JobsService, useValue: new JobsService(prisma, now) },
        { provide: ConnectionsService, useValue: connections },
        { provide: MappingsService, useValue: new MappingsService(prisma, connections, now) },
        {
          provide: SyncService,
          useValue: new SyncService(
            prisma,
            connections,
            new DeliveryService(publishing, schemas),
            schemas,
            publishing,
            deps.keyring,
            now,
          ),
        },
        CleanupTask,
        SyncJobTask,
        DriftTask,
      ],
    };
  }
}
