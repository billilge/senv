import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UserView } from '../auth/auth-service.js';
import { type DeliveredValues, DeliveryService } from '../delivery/delivery-service.js';
import { AdminOnly, CurrentUser } from '../http/access.js';
import {
  apiErrorSchema,
  deliveredValuesSchema,
  environmentValuesSchema,
  projectListSchema,
  projectSchema,
  publishResultSchema,
  versionListSchema,
} from '../http/api-schemas.js';
import {
  type ProjectSummary,
  type PublishResult,
  PublishService,
  type VersionInfo,
} from '../publishing/publish-service.js';
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

const rollbackBody = z.object({
  toVersion: z.number().int().min(1),
  baseVersion: z.number().int().min(0),
  message: z.string().max(500).optional(),
});

/** 편집 화면용 값. 공유 참조를 바꾸기 전의 원래 값이다 */
interface EnvironmentValues {
  project: string;
  env: string;
  version: number;
  variables: Record<string, string>;
}

@ApiTags('projects')
@ApiBearerAuth()
@ApiCookieAuth()
@ApiResponse({ status: 'default', description: '오류', standardSchema: apiErrorSchema })
@Controller('api/v1/projects')
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(PublishService) private readonly publishing: PublishService,
    @Inject(DeliveryService) private readonly delivery: DeliveryService,
  ) {}

  @Get()
  @ApiQuery({ name: 'include', required: false, enum: ['summary'] })
  @ApiResponse({ status: 200, standardSchema: projectListSchema })
  async list(
    @Query('include') include?: string,
  ): Promise<{ projects: (ProjectView & { summary?: ProjectSummary })[] }> {
    const projects = await this.projects.list();
    if (include !== 'summary') return { projects };
    const summaries = await this.publishing.summarize(projects.map((project) => project.name));
    return {
      projects: projects.map((project) => ({ ...project, summary: summaries.get(project.name) })),
    };
  }

  /** M1에서 멤버는 값을 읽고 쓰고, 프로젝트를 만드는 것처럼 구조를 바꾸는 일은 관리자만 한다 */
  @Post()
  @AdminOnly()
  @HttpCode(201)
  @ApiResponse({ status: 201, standardSchema: projectSchema })
  create(@Body({ schema: createProjectBody }) body: z.infer<typeof createProjectBody>) {
    return this.projects.create(body);
  }

  @Get(':project')
  @ApiResponse({ status: 200, standardSchema: projectSchema })
  get(@Param('project') project: string): Promise<ProjectView> {
    return this.projects.get(project);
  }

  @Get(':project/envs/:env')
  @ApiResponse({ status: 200, standardSchema: environmentValuesSchema })
  async current(
    @Param('project') project: string,
    @Param('env') env: string,
  ): Promise<EnvironmentValues> {
    return { project, env, ...(await this.publishing.getCurrent(project, env)) };
  }

  /** senv pull·run이 받는 값 (공유 참조 해석 후) */
  @Get(':project/envs/:env/variables')
  @ApiResponse({ status: 200, standardSchema: deliveredValuesSchema })
  variables(
    @Param('project') project: string,
    @Param('env') env: string,
  ): Promise<DeliveredValues> {
    return this.delivery.resolve(project, env);
  }

  @Post(':project/envs/:env/versions')
  @HttpCode(201)
  @ApiResponse({ status: 201, standardSchema: publishResultSchema })
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

  @Get(':project/envs/:env/versions')
  @ApiResponse({ status: 200, standardSchema: versionListSchema })
  async versions(
    @Param('project') project: string,
    @Param('env') env: string,
  ): Promise<{ versions: VersionInfo[] }> {
    return { versions: await this.publishing.listVersions(project, env) };
  }

  /** 지난 버전의 값 (공유 참조를 해석하기 전) */
  @Get(':project/envs/:env/versions/:version')
  @ApiResponse({ status: 200, standardSchema: environmentValuesSchema })
  async version(
    @Param('project') project: string,
    @Param('env') env: string,
    @Param('version') version: string,
  ): Promise<EnvironmentValues> {
    return { project, env, ...(await this.publishing.getVersion(project, env, Number(version))) };
  }

  /** 지난 버전의 값으로 새 버전을 게시한다 */
  @Post(':project/envs/:env/rollback')
  @HttpCode(201)
  @ApiResponse({ status: 201, standardSchema: publishResultSchema })
  rollback(
    @Param('project') project: string,
    @Param('env') env: string,
    @Body({ schema: rollbackBody }) body: z.infer<typeof rollbackBody>,
    @CurrentUser() user: UserView,
  ): Promise<PublishResult> {
    return this.publishing.rollback({ project, env, ...body, actor: user.id });
  }
}
