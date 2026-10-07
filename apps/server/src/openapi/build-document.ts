import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app/app.module.js';
import type { AppDependencies } from '../app/app-dependencies.js';
import { SESSION_COOKIE } from '../http/access.js';

/**
 * DB 없이 컨트롤러 정의만으로 OpenAPI 문서를 만든다.
 * 미리보기 모드는 프로바이더를 만들지 않으므로 의존성은 빈 값이어도 된다.
 */
export async function buildOpenApiDocument(): Promise<OpenAPIObject> {
  const app = await NestFactory.create(AppModule.register({} as AppDependencies), {
    preview: true,
    logger: false,
    abortOnError: false,
  });
  const config = new DocumentBuilder()
    .setTitle('Stream Env Control API')
    .setDescription(
      '환경변수 중앙 관리 서버 API. CLI는 Bearer 토큰, 대시보드는 세션 쿠키로 인증한다.',
    )
    .setVersion('1')
    .addBearerAuth()
    .addCookieAuth(SESSION_COOKIE)
    .build();
  const document = SwaggerModule.createDocument(app, config);
  await app.close();
  return document;
}
