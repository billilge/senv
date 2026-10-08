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
import { LOCAL_LINK_STATES } from '@senv/core';
import { z } from 'zod';
import type { UserView } from '../auth/auth-service.js';
import { CliTokenOnly, CurrentUser } from '../http/access.js';
import {
  agentDeviceListSchema,
  agentDeviceSchema,
  apiErrorSchema,
  localLinkListSchema,
  localLinkSchema,
} from '../http/api-schemas.js';
import { type DeviceView, LocalLinksService, type LocalLinkView } from './local-links-service.js';

const path = z.string().max(1024);
const createLinkBody = z.object({ deviceId: z.string().min(1), project: z.string().min(1), path });
const updateLinkBody = z.object({ path: path.optional(), paused: z.boolean().optional() });
const registerDeviceBody = z.object({ name: z.string().max(200) });
const addLinkBody = z.object({ project: z.string().min(1), path });
const versionPair = z.object({
  version: z.number().int().min(0),
  sharedVersion: z.number().int().min(0),
});
const reportBody = z.object({
  state: z.enum(LOCAL_LINK_STATES),
  message: z.string().max(1000).optional(),
  written: versionPair.optional(),
});

/**
 * 로컬 자동 받기 (M1.1, PRD 결정 60~63).
 * /me/*는 대시보드(또는 CLI)에서 내 기기·연결을 다루고, /agent/*는 senv agent만 부른다.
 * 연결 승인은 CLI 토큰으로만 할 수 있다 (결정 61).
 */
@ApiTags('local-links')
@ApiBearerAuth()
@ApiCookieAuth()
@ApiResponse({ status: 'default', description: '오류', standardSchema: apiErrorSchema })
@Controller()
export class LocalLinksController {
  constructor(@Inject(LocalLinksService) private readonly links: LocalLinksService) {}

  @Get('api/v1/me/devices')
  @ApiResponse({ status: 200, standardSchema: agentDeviceListSchema })
  async devices(@CurrentUser() user: UserView): Promise<{ devices: DeviceView[] }> {
    return { devices: await this.links.listDevices(user.id) };
  }

  @Delete('api/v1/me/devices/:id')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: '기기와 그 연결을 지웠다' })
  removeDevice(@CurrentUser() user: UserView, @Param('id') id: string): Promise<void> {
    return this.links.removeDevice(user.id, id);
  }

  @Get('api/v1/me/local-links')
  @ApiResponse({ status: 200, standardSchema: localLinkListSchema })
  async list(@CurrentUser() user: UserView): Promise<{ links: LocalLinkView[] }> {
    return { links: await this.links.list(user.id) };
  }

  @Post('api/v1/me/local-links')
  @HttpCode(201)
  @ApiResponse({ status: 201, standardSchema: localLinkSchema })
  create(
    @CurrentUser() user: UserView,
    @Body({ schema: createLinkBody }) body: z.infer<typeof createLinkBody>,
  ): Promise<LocalLinkView> {
    return this.links.create(user.id, body);
  }

  @Patch('api/v1/me/local-links/:id')
  @ApiResponse({ status: 200, standardSchema: localLinkSchema })
  update(
    @CurrentUser() user: UserView,
    @Param('id') id: string,
    @Body({ schema: updateLinkBody }) body: z.infer<typeof updateLinkBody>,
  ): Promise<LocalLinkView> {
    return this.links.update(user.id, id, body);
  }

  @Delete('api/v1/me/local-links/:id')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: '연결을 지웠다 (파일은 지우지 않는다)' })
  remove(@CurrentUser() user: UserView, @Param('id') id: string): Promise<void> {
    return this.links.remove(user.id, id);
  }

  @Post('api/v1/me/local-links/:id/overwrite')
  @HttpCode(200)
  @ApiResponse({ status: 200, standardSchema: localLinkSchema })
  overwrite(@CurrentUser() user: UserView, @Param('id') id: string): Promise<LocalLinkView> {
    return this.links.requestOverwrite(user.id, id);
  }

  @Post('api/v1/agent/devices')
  @CliTokenOnly()
  @HttpCode(201)
  @ApiResponse({ status: 201, standardSchema: agentDeviceSchema })
  registerDevice(
    @CurrentUser() user: UserView,
    @Body({ schema: registerDeviceBody }) body: z.infer<typeof registerDeviceBody>,
  ): Promise<DeviceView> {
    return this.links.registerDevice(user.id, body.name);
  }

  @Get('api/v1/agent/devices/:id/links')
  @CliTokenOnly()
  @ApiResponse({ status: 200, standardSchema: localLinkListSchema })
  async forDevice(
    @CurrentUser() user: UserView,
    @Param('id') id: string,
  ): Promise<{ links: LocalLinkView[] }> {
    return { links: await this.links.forDevice(user.id, id) };
  }

  @Post('api/v1/agent/devices/:id/links')
  @CliTokenOnly()
  @HttpCode(201)
  @ApiResponse({ status: 201, standardSchema: localLinkSchema })
  add(
    @CurrentUser() user: UserView,
    @Param('id') id: string,
    @Body({ schema: addLinkBody }) body: z.infer<typeof addLinkBody>,
  ): Promise<LocalLinkView> {
    return this.links.create(user.id, { deviceId: id, ...body }, { approved: true });
  }

  @Post('api/v1/agent/links/:id/approve')
  @CliTokenOnly()
  @HttpCode(200)
  @ApiResponse({ status: 200, standardSchema: localLinkSchema })
  approve(@CurrentUser() user: UserView, @Param('id') id: string): Promise<LocalLinkView> {
    return this.links.approve(user.id, id);
  }

  @Post('api/v1/agent/links/:id/reject')
  @CliTokenOnly()
  @HttpCode(204)
  @ApiResponse({ status: 204, description: '연결을 지웠다' })
  reject(@CurrentUser() user: UserView, @Param('id') id: string): Promise<void> {
    return this.links.remove(user.id, id);
  }

  @Post('api/v1/agent/links/:id/report')
  @CliTokenOnly()
  @HttpCode(200)
  @ApiResponse({ status: 200, standardSchema: localLinkSchema })
  report(
    @CurrentUser() user: UserView,
    @Param('id') id: string,
    @Body({ schema: reportBody }) body: z.infer<typeof reportBody>,
  ): Promise<LocalLinkView> {
    return this.links.report(user.id, id, body);
  }
}
