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
import { z } from 'zod';
import type { UserView } from '../auth/auth-service.js';
import { AdminOnly, CurrentUser } from '../http/access.js';
import {
  apiErrorSchema,
  targetConnectionListSchema,
  targetConnectionSchema,
  targetProviderListSchema,
  targetResourceListSchema,
} from '../http/api-schemas.js';
import { ConnectionsService, type ConnectionView } from './connections-service.js';
import { TargetRegistry } from './target-registry.js';

const createConnectionBody = z.object({
  name: z.string().trim().min(1).max(64),
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
});

const updateConnectionBody = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

/** 배포 대상 제공자와 연결 (PRD 8.1, 결정 52). 연결은 관리자만 다룬다 */
@ApiTags('targets')
@ApiBearerAuth()
@ApiCookieAuth()
@ApiResponse({ status: 'default', description: '오류', standardSchema: apiErrorSchema })
@Controller('api/v1/targets')
export class TargetsController {
  constructor(
    @Inject(TargetRegistry) private readonly registry: TargetRegistry,
    @Inject(ConnectionsService) private readonly connections: ConnectionsService,
  ) {}

  @Get('providers')
  @ApiResponse({ status: 200, standardSchema: targetProviderListSchema })
  providers() {
    return {
      providers: this.registry.list().map((provider) => ({
        type: provider.type,
        displayName: provider.displayName,
        capabilities: provider.capabilities,
        connectionFields: provider.connectionFields,
        mappingOptionFields: provider.mappingOptionFields,
      })),
    };
  }

  @Get('connections')
  @AdminOnly()
  @ApiResponse({ status: 200, standardSchema: targetConnectionListSchema })
  async listConnections(): Promise<{ connections: ConnectionView[] }> {
    return { connections: await this.connections.list() };
  }

  @Post('connections')
  @AdminOnly()
  @HttpCode(201)
  @ApiResponse({ status: 201, standardSchema: targetConnectionSchema })
  createConnection(
    @Body({ schema: createConnectionBody }) body: z.infer<typeof createConnectionBody>,
    @CurrentUser() user: UserView,
  ): Promise<ConnectionView> {
    return this.connections.create(body, user.id);
  }

  @Patch('connections/:id')
  @AdminOnly()
  @ApiResponse({ status: 200, standardSchema: targetConnectionSchema })
  updateConnection(
    @Param('id') id: string,
    @Body({ schema: updateConnectionBody }) body: z.infer<typeof updateConnectionBody>,
  ): Promise<ConnectionView> {
    return this.connections.update(id, body);
  }

  @Delete('connections/:id')
  @AdminOnly()
  @HttpCode(204)
  @ApiResponse({ status: 204, description: '지움' })
  async removeConnection(@Param('id') id: string): Promise<void> {
    await this.connections.remove(id);
  }

  @Post('connections/:id/test')
  @AdminOnly()
  @HttpCode(204)
  @ApiResponse({ status: 204, description: '연결됨' })
  async testConnection(@Param('id') id: string): Promise<void> {
    await this.connections.test(id);
  }

  @Get('connections/:id/resources')
  @AdminOnly()
  @ApiResponse({ status: 200, standardSchema: targetResourceListSchema })
  async resources(@Param('id') id: string) {
    return { resources: await this.connections.resources(id) };
  }
}
