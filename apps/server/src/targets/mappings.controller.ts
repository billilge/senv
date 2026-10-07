import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ENVIRONMENT_NAMES } from '@senv/core';
import { z } from 'zod';
import type { UserView } from '../auth/auth-service.js';
import { AdminOnly, CurrentUser } from '../http/access.js';
import {
  apiErrorSchema,
  driftResultSchema,
  importResultSchema,
  syncPreviewSchema,
  syncRunListSchema,
  syncRunSchema,
  targetMappingListSchema,
  targetMappingSchema,
} from '../http/api-schemas.js';
import { ProjectsService } from '../projects/projects-service.js';
import { MappingsService, type MappingView } from './mappings-service.js';
import { type SyncPreview, type SyncRunView, SyncService } from './sync-service.js';

const optionFields = {
  syncMode: z.enum(['auto', 'manual']).optional(),
  afterSync: z.enum(['auto', 'none', 'restart', 'redeploy']).optional(),
  unmanaged: z.enum(['keep', 'delete']).optional(),
  include: z.array(z.string().max(100)).max(50).optional(),
  exclude: z.array(z.string().max(100)).max(50).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
};

const createMappingBody = z.object({
  connectionId: z.string().min(1),
  env: z.enum(ENVIRONMENT_NAMES),
  resourceId: z.string().min(1),
  ...optionFields,
});

const updateMappingBody = z.object({ env: z.enum(ENVIRONMENT_NAMES).optional(), ...optionFields });

/** 매핑과 동기화 (PRD 8.1~8.4, 결정 52~55). 매핑 관리는 관리자, 동기화는 활성 멤버 */
@ApiTags('targets')
@ApiBearerAuth()
@ApiCookieAuth()
@ApiResponse({ status: 'default', description: '오류', standardSchema: apiErrorSchema })
@Controller()
export class MappingsController {
  constructor(
    @Inject(MappingsService) private readonly mappings: MappingsService,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  @Get('api/v1/projects/:project/targets')
  @ApiResponse({ status: 200, standardSchema: targetMappingListSchema })
  async list(@Param('project') project: string): Promise<{ mappings: MappingView[] }> {
    await this.projects.get(project);
    return { mappings: await this.mappings.list(project) };
  }

  @Post('api/v1/projects/:project/targets')
  @AdminOnly()
  @HttpCode(201)
  @ApiResponse({ status: 201, standardSchema: targetMappingSchema })
  create(
    @Param('project') project: string,
    @Body({ schema: createMappingBody }) body: z.infer<typeof createMappingBody>,
  ): Promise<MappingView> {
    return this.mappings.create(project, body);
  }

  @Patch('api/v1/targets/mappings/:id')
  @AdminOnly()
  @ApiResponse({ status: 200, standardSchema: targetMappingSchema })
  update(
    @Param('id') id: string,
    @Body({ schema: updateMappingBody }) body: z.infer<typeof updateMappingBody>,
  ): Promise<MappingView> {
    return this.mappings.update(id, body);
  }

  @Delete('api/v1/targets/mappings/:id')
  @AdminOnly()
  @HttpCode(204)
  @ApiResponse({ status: 204, description: '지움' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.mappings.remove(id);
  }

  /** 반영하지 않고 바뀔 키와 반영 후 동작을 본다 */
  @Get('api/v1/targets/mappings/:id/plan')
  @ApiResponse({ status: 200, standardSchema: syncPreviewSchema })
  plan(@Param('id') id: string): Promise<SyncPreview> {
    return this.sync.plan(id);
  }

  /** 지금 동기화한다. API에서 바로 실행하고 결과를 돌려준다 (결정 53) */
  @Post('api/v1/targets/mappings/:id/sync')
  @HttpCode(200)
  @ApiResponse({ status: 200, standardSchema: syncRunSchema })
  syncNow(@Param('id') id: string, @CurrentUser() user: UserView): Promise<SyncRunView> {
    return this.sync.sync(id, { trigger: 'manual', actor: user.id });
  }

  @Get('api/v1/targets/mappings/:id/runs')
  @ApiResponse({ status: 200, standardSchema: syncRunListSchema })
  async runs(@Param('id') id: string): Promise<{ runs: SyncRunView[] }> {
    return { runs: await this.sync.runs(id) };
  }

  /** 원격 값을 그 환경의 새 버전으로 게시한다 (결정 55) */
  @Post('api/v1/targets/mappings/:id/import')
  @HttpCode(201)
  @ApiResponse({ status: 201, standardSchema: importResultSchema })
  importRemote(@Param('id') id: string, @CurrentUser() user: UserView) {
    return this.sync.importRemote(id, user.id);
  }

  /** 드리프트를 지금 확인한다 (worker는 1시간마다 확인한다, 결정 54) */
  @Post('api/v1/targets/mappings/:id/drift')
  @HttpCode(200)
  @ApiResponse({ status: 200, standardSchema: driftResultSchema })
  async drift(@Param('id') id: string): Promise<{ driftKeys: string[] }> {
    return { driftKeys: await this.sync.checkDrift(id) };
  }
}
