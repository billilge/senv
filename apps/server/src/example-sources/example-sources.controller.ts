import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { SERVER_CONFIG } from '../app/app-dependencies.js';
import type { UserView } from '../auth/auth-service.js';
import type { ServerConfig } from '../config/server-config.js';
import { AdminOnly, CurrentUser } from '../http/access.js';
import {
  apiErrorSchema,
  exampleSourceSchema,
  exampleSourceStatusSchema,
} from '../http/api-schemas.js';
import { ExampleSourceService, type ExampleSourceView } from './example-source-service.js';

const linkBody = z.object({
  repoId: z.number().int().positive(),
  path: z.string().max(512),
});

/**
 * 프로젝트의 .env.example 연결 (M1.2, PRD 결정 73~76).
 * 연결·변경·끊기는 관리자, 상태 보기·지금 확인은 활성 멤버가 한다.
 */
@ApiTags('example-source')
@ApiBearerAuth()
@ApiCookieAuth()
@ApiResponse({ status: 'default', description: '오류', standardSchema: apiErrorSchema })
@Controller('api/v1/projects/:project/example-source')
export class ExampleSourcesController {
  constructor(
    @Inject(ExampleSourceService) private readonly sources: ExampleSourceService,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: exampleSourceStatusSchema })
  async status(@Param('project') project: string): Promise<{
    enabled: boolean;
    installUrl: string | null;
    source: ExampleSourceView | null;
  }> {
    const slug = this.config.githubApp?.slug;
    return {
      enabled: this.sources.enabled,
      installUrl: slug ? `https://github.com/apps/${slug}/installations/new` : null,
      source: await this.sources.get(project),
    };
  }

  @Put()
  @AdminOnly()
  @ApiResponse({ status: 200, standardSchema: exampleSourceSchema })
  link(
    @Param('project') project: string,
    @Body({ schema: linkBody }) body: z.infer<typeof linkBody>,
    @CurrentUser() user: UserView,
  ): Promise<ExampleSourceView> {
    return this.sources.link(project, body, user.id);
  }

  @Delete()
  @AdminOnly()
  @HttpCode(204)
  @ApiResponse({ status: 204, description: '연결을 끊었다. 등록된 키는 남는다' })
  unlink(@Param('project') project: string): Promise<void> {
    return this.sources.unlink(project);
  }

  @Post('check')
  @HttpCode(200)
  @ApiResponse({ status: 200, standardSchema: exampleSourceSchema })
  check(
    @Param('project') project: string,
    @CurrentUser() user: UserView,
  ): Promise<ExampleSourceView> {
    return this.sources.check(project, user.id);
  }
}
