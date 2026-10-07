import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UserView } from '../auth/auth-service.js';
import { AdminOnly, CurrentUser } from '../http/access.js';
import { apiErrorSchema, userListSchema, userSchema } from '../http/api-schemas.js';
import { UsersService } from './users-service.js';

const roleBody = z.object({ role: z.enum(['admin', 'member']) });

/** 관리자의 사용자 관리 (M1: 승인, 비활성화, 역할 변경) */
@ApiTags('users')
@ApiBearerAuth()
@ApiCookieAuth()
@ApiResponse({ status: 'default', description: '오류', standardSchema: apiErrorSchema })
@Controller('api/v1/users')
@AdminOnly()
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: userListSchema })
  async list(@CurrentUser() actor: UserView): Promise<{ users: UserView[] }> {
    return { users: await this.users.list(actor) };
  }

  @Post(':id/activate')
  @HttpCode(200)
  @ApiResponse({ status: 200, standardSchema: userSchema })
  activate(@Param('id') id: string, @CurrentUser() actor: UserView): Promise<UserView> {
    return this.users.activate(id, actor);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @ApiResponse({ status: 200, standardSchema: userSchema })
  disable(@Param('id') id: string, @CurrentUser() actor: UserView): Promise<UserView> {
    return this.users.disable(id, actor);
  }

  @Put(':id/role')
  @ApiResponse({ status: 200, standardSchema: userSchema })
  setRole(
    @Param('id') id: string,
    @Body({ schema: roleBody }) body: z.infer<typeof roleBody>,
    @CurrentUser() actor: UserView,
  ): Promise<UserView> {
    return this.users.setRole(id, body.role, actor);
  }
}
