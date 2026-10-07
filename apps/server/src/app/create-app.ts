import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { RequestValidationError } from '../http/api-error.js';
import { ApiExceptionFilter } from '../http/api-exception.filter.js';
import { AppModule } from './app.module.js';
import type { AppDependencies } from './app-dependencies.js';

export async function createApp(
  deps: AppDependencies,
  options: { logger?: boolean } = {},
): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(deps), {
    logger: options.logger === false ? false : ['error', 'warn', 'log'],
  });
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) =>
        new RequestValidationError(
          issues.map((issue) => ({
            path: (issue.path ?? [])
              .map((segment) => (typeof segment === 'object' ? segment.key : segment))
              .join('.'),
            message: issue.message,
          })),
        ),
    }),
  );
  return app;
}
