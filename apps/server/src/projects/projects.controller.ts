import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type { UserView } from '../auth/auth-service.js';
import { type DeliveredValues, DeliveryService } from '../delivery/delivery-service.js';
import { AdminOnly, CurrentUser } from '../http/access.js';
import { type PublishResult, PublishService } from '../publishing/publish-service.js';
import { ProjectsService, type ProjectView } from './projects-service.js';

const createProjectBody = z.object({
  name: z.string(),
  displayName: z.string().max(100).optional(),
});

const publishBody = z.object({
  baseVersion: z.number().int().min(0),
  changes: z.object({
    set: z.record(z.string(), z.string()).optional(),
    remove: z.array(z.string()).optional(),
  }),
  message: z.string().max(500).optional(),
});

/** 편집 화면용 값. 공유 참조를 바꾸기 전의 원래 값이다 */
interface EnvironmentValues {
  project: string;
  env: string;
  version: number;
  variables: Record<string, string>;
}

@Controller('api/v1/projects')
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(PublishService) private readonly publishing: PublishService,
    @Inject(DeliveryService) private readonly delivery: DeliveryService,
  ) {}

  @Get()
  async list(): Promise<{ projects: ProjectView[] }> {
    return { projects: await this.projects.list() };
  }

  /** M1에서 멤버는 값을 읽고 쓰고, 프로젝트를 만드는 것처럼 구조를 바꾸는 일은 관리자만 한다 */
  @Post()
  @AdminOnly()
  @HttpCode(201)
  create(@Body({ schema: createProjectBody }) body: z.infer<typeof createProjectBody>) {
    return this.projects.create(body);
  }

  @Get(':project')
  get(@Param('project') project: string): Promise<ProjectView> {
    return this.projects.get(project);
  }

  @Get(':project/envs/:env')
  async current(
    @Param('project') project: string,
    @Param('env') env: string,
  ): Promise<EnvironmentValues> {
    return { project, env, ...(await this.publishing.getCurrent(project, env)) };
  }

  /** senv pull·run이 받는 값 (공유 참조 해석 후) */
  @Get(':project/envs/:env/variables')
  variables(
    @Param('project') project: string,
    @Param('env') env: string,
  ): Promise<DeliveredValues> {
    return this.delivery.resolve(project, env);
  }

  @Post(':project/envs/:env/versions')
  @HttpCode(201)
  publish(
    @Param('project') project: string,
    @Param('env') env: string,
    @Body({ schema: publishBody }) body: z.infer<typeof publishBody>,
    @CurrentUser() user: UserView,
  ): Promise<PublishResult> {
    return this.publishing.publish({
      project,
      env,
      baseVersion: body.baseVersion,
      changes: body.changes,
      message: body.message,
      actor: user.id,
    });
  }
}
