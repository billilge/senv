import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiTokenService } from '../auth/api-token-service.js';
import { AuthController } from '../auth/auth.controller.js';
import { AuthService } from '../auth/auth-service.js';
import { DeviceAuthService } from '../auth/device-auth-service.js';
import { GitHubClient } from '../auth/github-client.js';
import { SessionService } from '../auth/session-service.js';
import { WebAuthController } from '../auth/web-auth.controller.js';
import type { ServerConfig } from '../config/server-config.js';
import { DeliveryService } from '../delivery/delivery-service.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { HealthController } from '../health/health.controller.js';
import { AuthGuard } from '../http/auth.guard.js';
import { RATE_LIMITS } from '../http/rate-limit.js';
import { KeySchemaService } from '../key-schemas/key-schema-service.js';
import { KeySchemasController } from '../key-schemas/key-schemas.controller.js';
import { ProjectsController } from '../projects/projects.controller.js';
import { ProjectsService } from '../projects/projects-service.js';
import { PublishService } from '../publishing/publish-service.js';
import { SnapshotService } from '../snapshots/snapshot-service.js';
import { SnapshotStore } from '../storage/snapshot-store.js';
import { UsersController } from '../users/users.controller.js';
import { UsersService } from '../users/users-service.js';
import { type AppDependencies, CLOCK, SERVER_CONFIG } from './app-dependencies.js';
import { dashboardStaticOptions } from './dashboard.js';

type Clock = () => Date;

/**
 * 서비스는 Nest에 묶이지 않은 일반 클래스라, 여기서 팩토리로 조립한다.
 * 바깥 의존성(DB, 저장소, GitHub, 시계)은 register()로 받는다.
 */
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest 동적 모듈은 static register()를 가진 클래스로 만든다
export class AppModule {
  static register(deps: AppDependencies): DynamicModule {
    return {
      module: AppModule,
      // 한도는 경로마다 @RateLimit으로 정한다. 여기 기본값은 쓰이지 않는다
      imports: [
        ThrottlerModule.forRoot({ throttlers: [RATE_LIMITS.tokenIssue] }),
        ...(deps.dashboardDir
          ? [ServeStaticModule.forRoot(dashboardStaticOptions(deps.dashboardDir))]
          : []),
      ],
      controllers: [
        HealthController,
        AuthController,
        WebAuthController,
        ProjectsController,
        KeySchemasController,
        UsersController,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: SERVER_CONFIG, useValue: deps.config },
        { provide: CLOCK, useValue: deps.now ?? (() => new Date()) },
        { provide: PrismaClient, useValue: deps.prisma },
        { provide: SnapshotStore, useValue: deps.snapshotStore },
        { provide: GitHubClient, useValue: deps.github },
        {
          provide: SnapshotService,
          useFactory: (store: SnapshotStore, config: ServerConfig) =>
            new SnapshotService(store, config.keyring),
          inject: [SnapshotStore, SERVER_CONFIG],
        },
        {
          provide: ProjectsService,
          useFactory: (prisma: PrismaClient) => new ProjectsService(prisma),
          inject: [PrismaClient],
        },
        {
          // 앱이 뜰 때 공유 그룹 특수 프로젝트를 보장한다 (비동기 팩토리는 초기화 중에 기다린다)
          provide: 'SHARED_PROJECT_READY',
          useFactory: (projects: ProjectsService) => projects.ensureSharedProject(),
          inject: [ProjectsService],
        },
        {
          provide: KeySchemaService,
          useFactory: (prisma: PrismaClient, now: Clock) => new KeySchemaService(prisma, now),
          inject: [PrismaClient, CLOCK],
        },
        {
          provide: PublishService,
          useFactory: (prisma: PrismaClient, snapshots: SnapshotService, now: Clock) =>
            new PublishService(prisma, snapshots, now),
          inject: [PrismaClient, SnapshotService, CLOCK],
        },
        {
          provide: DeliveryService,
          useFactory: (publishing: PublishService, keySchemas: KeySchemaService) =>
            new DeliveryService(publishing, keySchemas),
          inject: [PublishService, KeySchemaService],
        },
        {
          provide: AuthService,
          useFactory: (
            prisma: PrismaClient,
            github: GitHubClient,
            config: ServerConfig,
            now: Clock,
          ) =>
            new AuthService(
              prisma,
              github,
              { org: config.github.org, bootstrapAdmins: config.bootstrapAdmins },
              now,
            ),
          inject: [PrismaClient, GitHubClient, SERVER_CONFIG, CLOCK],
        },
        {
          provide: SessionService,
          useFactory: (prisma: PrismaClient, now: Clock) => new SessionService(prisma, now),
          inject: [PrismaClient, CLOCK],
        },
        {
          provide: ApiTokenService,
          useFactory: (prisma: PrismaClient, now: Clock) => new ApiTokenService(prisma, now),
          inject: [PrismaClient, CLOCK],
        },
        {
          provide: DeviceAuthService,
          useFactory: (
            prisma: PrismaClient,
            tokens: ApiTokenService,
            config: ServerConfig,
            now: Clock,
          ) =>
            new DeviceAuthService(
              prisma,
              tokens,
              { verificationUri: `${config.appUrl}/device` },
              now,
            ),
          inject: [PrismaClient, ApiTokenService, SERVER_CONFIG, CLOCK],
        },
        {
          provide: UsersService,
          useFactory: (prisma: PrismaClient, sessions: SessionService, tokens: ApiTokenService) =>
            new UsersService(prisma, sessions, tokens),
          inject: [PrismaClient, SessionService, ApiTokenService],
        },
      ],
    };
  }
}
