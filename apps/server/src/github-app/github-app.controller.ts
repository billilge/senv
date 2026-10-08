import { Controller, Get, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiExcludeEndpoint,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { SERVER_CONFIG } from '../app/app-dependencies.js';
import type { ServerConfig } from '../config/server-config.js';
import {
  ExampleSourceService,
  GitHubAppDisabledError,
} from '../example-sources/example-source-service.js';
import { AdminOnly, Public } from '../http/access.js';
import { ApiProblem } from '../http/api-error.js';
import { apiErrorSchema, githubRepositoryListSchema } from '../http/api-schemas.js';
import { verifyWebhookSignature } from './app-auth.js';

const pushPayload = z.object({
  ref: z.string(),
  repository: z.object({
    id: z.number().int(),
    full_name: z.string(),
    default_branch: z.string(),
  }),
  installation: z.object({ id: z.number().int() }).optional(),
  sender: z.object({ login: z.string() }),
});

/** .env.example 연결에 쓰는 GitHub App: 설치된 저장소 목록과 웹훅 (M1.2, PRD 결정 73·76) */
@ApiTags('github')
@ApiBearerAuth()
@ApiCookieAuth()
@ApiResponse({ status: 'default', description: '오류', standardSchema: apiErrorSchema })
@Controller('api/v1/github')
export class GitHubAppController {
  constructor(
    @Inject(ExampleSourceService) private readonly sources: ExampleSourceService,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  @Get('repositories')
  @AdminOnly()
  @ApiResponse({ status: 200, standardSchema: githubRepositoryListSchema })
  async repositories(): Promise<{ repositories: { id: number; fullName: string }[] }> {
    const repositories = await this.sources.listRepositories();
    return { repositories: repositories.map(({ id, fullName }) => ({ id, fullName })) };
  }

  /**
   * GitHub 웹훅. 세션·토큰 대신 서명을 확인하고, 기본 브랜치 push만 처리한다.
   * 다른 이벤트(ping, 설치 변경 등)는 받기만 한다. 본문은 readWebhookBody가 Buffer로 읽어 둔다
   */
  @Post('webhook')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(
    @Req() request: Request,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ): Promise<{ checked: number }> {
    const app = this.config.githubApp;
    if (!app) throw new GitHubAppDisabledError();
    const body: Buffer = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (!verifyWebhookSignature(app.webhookSecret, body, signature)) {
      throw new ApiProblem(401, 'invalid_signature', '웹훅 서명이 맞지 않습니다');
    }
    if (event !== 'push') return { checked: 0 };

    let parsed: z.infer<typeof pushPayload>;
    try {
      parsed = pushPayload.parse(JSON.parse(body.toString('utf8')));
    } catch {
      throw new ApiProblem(400, 'invalid_request', 'push 웹훅 본문을 읽지 못했습니다');
    }
    const checked = await this.sources.handlePush({
      ref: parsed.ref,
      repository: {
        id: parsed.repository.id,
        fullName: parsed.repository.full_name,
        defaultBranch: parsed.repository.default_branch,
      },
      installationId: parsed.installation?.id ?? null,
      sender: parsed.sender.login,
    });
    return { checked };
  }
}
