import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { toApiError } from './api-error.js';

/** 모든 오류를 { code, message, details } 형식으로 응답한다 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = toApiError(exception);
    // 5xx는 원인을 서버 로그에만 남긴다. 응답에는 일반 메시지만 간다
    if (status >= 500) this.logger.error(exception);
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
