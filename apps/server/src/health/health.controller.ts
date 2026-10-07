import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client.js';

@Controller()
export class HealthController {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  /** Coolify 헬스체크. DB에 닿지 않으면 500이 나서 비정상으로 판정된다 */
  @Get('healthz')
  async health(): Promise<{ status: 'ok' }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}
