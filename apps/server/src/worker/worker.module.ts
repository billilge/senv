import { type DynamicModule, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaClient } from '../generated/prisma/client.js';
import { CleanupService } from '../maintenance/cleanup-service.js';
import { CleanupTask } from './cleanup.task.js';

export interface WorkerDependencies {
  prisma: PrismaClient;
  now?: () => Date;
}

/** 예약 작업을 돌리는 worker. HTTP는 열지 않는다 */
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest 동적 모듈은 static register()를 가진 클래스로 만든다
export class WorkerModule {
  static register(deps: WorkerDependencies): DynamicModule {
    return {
      module: WorkerModule,
      imports: [ScheduleModule.forRoot()],
      providers: [
        { provide: PrismaClient, useValue: deps.prisma },
        {
          provide: CleanupService,
          useFactory: (prisma: PrismaClient) => new CleanupService(prisma, deps.now),
          inject: [PrismaClient],
        },
        CleanupTask,
      ],
    };
  }
}
