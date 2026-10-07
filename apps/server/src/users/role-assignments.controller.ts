import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UserView } from '../auth/auth-service.js';
import { AdminOnly, CurrentUser } from '../http/access.js';
import {
  apiErrorSchema,
  roleAssignmentListSchema,
  roleAssignmentSchema,
} from '../http/api-schemas.js';
import { type RoleAssignmentView, UsersService } from './users-service.js';

const assignBody = z.object({ role: z.enum(['admin', 'member']) });

/** 아직 로그인하지 않은 GitHub 사용자의 역할을 미리 정한다 (관리자 전용, PRD 7.1) */
@ApiTags('users')
@ApiBearerAuth()
@ApiCookieAuth()
@ApiResponse({ status: 'default', description: '오류', standardSchema: apiErrorSchema })
@Controller('api/v1/role-assignments')
@AdminOnly()
export class RoleAssignmentsController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: roleAssignmentListSchema })
  async list(@CurrentUser() actor: UserView): Promise<{ assignments: RoleAssignmentView[] }> {
    return { assignments: await this.users.listAssignments(actor) };
  }

  @Put(':login')
  @ApiResponse({ status: 200, standardSchema: roleAssignmentSchema })
  assign(
    @Param('login') login: string,
    @Body({ schema: assignBody }) body: z.infer<typeof assignBody>,
    @CurrentUser() actor: UserView,
  ): Promise<RoleAssignmentView> {
    return this.users.assignRole(login, body.role, actor);
  }

  @Delete(':login')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: '지움' })
  async remove(@Param('login') login: string, @CurrentUser() actor: UserView): Promise<void> {
    await this.users.removeAssignment(login, actor);
  }
}
