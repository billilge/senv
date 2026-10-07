import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './build-document.js';

type Document = Awaited<ReturnType<typeof buildOpenApiDocument>>;
let document: Document;

beforeAll(async () => {
  document = await buildOpenApiDocument();
});

function operations(doc: Document): string[] {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
      .map((method) => `${method.toUpperCase()} ${path}`),
  );
}

describe('OpenAPI 문서', () => {
  it('클라이언트가 쓰는 모든 API 경로를 담는다', () => {
    expect(operations(document).sort()).toEqual(
      [
        'GET /healthz',
        'GET /api/v1/me',
        'POST /api/v1/auth/device',
        'POST /api/v1/auth/device/token',
        'POST /api/v1/auth/device/approve',
        'POST /api/v1/auth/token/refresh',
        'POST /api/v1/auth/token/revoke',
        'POST /api/v1/auth/logout',
        'GET /api/v1/projects',
        'POST /api/v1/projects',
        'GET /api/v1/projects/{project}',
        'GET /api/v1/projects/{project}/envs/{env}',
        'GET /api/v1/projects/{project}/envs/{env}/variables',
        'POST /api/v1/projects/{project}/envs/{env}/versions',
        'GET /api/v1/users',
        'POST /api/v1/users/{id}/activate',
        'POST /api/v1/users/{id}/disable',
        'PUT /api/v1/users/{id}/role',
      ].sort(),
    );
  });

  it('브라우저 리다이렉트용 GitHub 로그인 경로는 담지 않는다', () => {
    expect(Object.keys(document.paths)).not.toContain('/auth/github');
    expect(Object.keys(document.paths)).not.toContain('/auth/github/callback');
  });

  it('요청 본문 스키마는 서버 검증에 쓰는 Zod 스키마에서 나온다', () => {
    const operation = document.paths['/api/v1/projects/{project}/envs/{env}/versions']?.post;
    const body = operation?.requestBody as {
      content: { 'application/json': { schema: Record<string, unknown> } };
    };
    expect(body.content['application/json'].schema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['baseVersion', 'changes']),
      properties: { baseVersion: { type: 'integer', minimum: 0 } },
    });
  });

  it('응답 스키마를 담는다 (pull용 값 조회 200)', () => {
    const operation = document.paths['/api/v1/projects/{project}/envs/{env}/variables']?.get;
    const response = operation?.responses['200'] as unknown as {
      content: { 'application/json': { schema: { $ref: string } } };
    };
    // 응답은 이름 붙은 공용 스키마(components.schemas)를 가리킨다
    const name = response.content['application/json'].schema.$ref.split('/').at(-1) ?? '';
    const schema = document.components?.schemas?.[name] as { properties: Record<string, unknown> };
    expect(name).toBe('DeliveredValues');
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['env', 'project', 'sharedVersion', 'variables', 'version'].sort(),
    );
  });

  it('커밋된 openapi.json이 지금 코드로 만든 문서와 같다 (바꾸면 pnpm openapi로 다시 만든다)', () => {
    const committed = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../openapi.json'), 'utf8'),
    );
    expect(committed).toEqual(JSON.parse(JSON.stringify(document)));
  });
});
