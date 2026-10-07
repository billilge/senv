import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ENVIRONMENT_NAMES } from '@senv/core';
import { z } from 'zod';
import type { UserView } from '../auth/auth-service.js';
import { AdminOnly, CurrentUser } from '../http/access.js';
import {
  apiErrorSchema,
  keySchemaListSchema,
  keySchemaSchema,
  publicPrefixesSchema,
} from '../http/api-schemas.js';
import {
  KeySchemaService,
  type KeySchemaView,
  type ProjectSchemaView,
} from './key-schema-service.js';

const keySchemaBody = z.object({
  type: z.enum(['string', 'url', 'number', 'boolean', 'json']).optional(),
  visibility: z.enum(['secret', 'public']).optional(),
  required: z.boolean().optional(),
  optionalIn: z.array(z.enum(ENVIRONMENT_NAMES)).optional(),
  buildTime: z.boolean().optional(),
  description: z.string().max(500).optional(),
});

const publicPrefixesBody = z.object({ publicPrefixes: z.array(z.string()).max(10) });

/** 프로젝트의 키 스키마 (PRD 5.2). 키 속성은 멤버가, 공개 접두사는 관리자가 정한다 */
@ApiTags('schema')
@ApiBearerAuth()
@ApiCookieAuth()
@ApiResponse({ status: 'default', description: '오류', standardSchema: apiErrorSchema })
@Controller('api/v1/projects/:project/schema')
export class KeySchemasController {
  constructor(@Inject(KeySchemaService) private readonly schemas: KeySchemaService) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: keySchemaListSchema })
  get(@Param('project') project: string): Promise<ProjectSchemaView> {
    return this.schemas.get(project);
  }

  @Put('keys/:key')
  @ApiResponse({ status: 200, standardSchema: keySchemaSchema })
  put(
    @Param('project') project: string,
    @Param('key') key: string,
    @Body({ schema: keySchemaBody }) body: z.infer<typeof keySchemaBody>,
    @CurrentUser() user: UserView,
  ): Promise<KeySchemaView> {
    return this.schemas.put(project, key, body, user.id);
  }

  @Delete('keys/:key')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: '지움' })
  async remove(@Param('project') project: string, @Param('key') key: string): Promise<void> {
    await this.schemas.remove(project, key);
  }

  @Put('public-prefixes')
  @AdminOnly()
  @ApiResponse({ status: 200, standardSchema: publicPrefixesSchema })
  async setPublicPrefixes(
    @Param('project') project: string,
    @Body({ schema: publicPrefixesBody }) body: z.infer<typeof publicPrefixesBody>,
  ): Promise<{ publicPrefixes: string[] }> {
    return { publicPrefixes: await this.schemas.setPublicPrefixes(project, body.publicPrefixes) };
  }
}
