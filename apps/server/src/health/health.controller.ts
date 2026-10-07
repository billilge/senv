import { Controller, Get, Inject } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaClient } from '../generated/prisma/client.js';
import { Public } from '../http/access.js';
import { healthSchema } from '../http/api-schemas.js';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  /** Coolify 헬스체크. DB에 닿지 않으면 500이 나서 비정상으로 판정된다 */
  @Get('healthz')
  @Public()
  @ApiResponse({ status: 200, standardSchema: healthSchema })
  async health(): Promise<{ status: 'ok' }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}
