import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProjectsService } from '../projects/projects-service.js';
import { createTestApp, signIn, type TestApp } from '../testing/app.js';
import { resetDatabase } from '../testing/database.js';

let t: TestApp;
let admin: { Authorization: string };
let member: { Authorization: string };

beforeAll(async () => {
  t = await createTestApp();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  await t.app.get(ProjectsService).create({ name: 'web' });
  admin = (await signIn(t, { login: 'admin', role: 'admin' })).auth;
  member = (await signIn(t, { login: 'bob' })).auth;
});
afterAll(() => t.close());

const base = '/api/v1/projects/web/schema';

describe('키 스키마 API', () => {
  it('멤버는 키 속성을 등록·조회·삭제한다', async () => {
    const put = await t
      .http()
      .put(`${base}/keys/VITE_API_URL`)
      .set(member)
      .send({ type: 'url', visibility: 'public', required: true, description: 'API 주소' });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({
      key: 'VITE_API_URL',
      type: 'url',
      visibility: 'public',
      required: true,
      optionalIn: [],
      buildTime: false,
      description: 'API 주소',
    });

    expect((await t.http().get(base).set(member)).body).toEqual({
      publicPrefixes: [],
      keys: [put.body],
    });

    expect((await t.http().delete(`${base}/keys/VITE_API_URL`).set(member)).status).toBe(204);
    const missing = await t.http().delete(`${base}/keys/VITE_API_URL`).set(member);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'key_schema_not_found' });
  });

  it('키 이름이 틀리면 422 invalid_key_name, 속성 값이 틀리면 400이다', async () => {
    const badKey = await t.http().put(`${base}/keys/bad-key`).set(member).send({});
    expect(badKey.status).toBe(422);
    expect(badKey.body).toMatchObject({ code: 'invalid_key_name' });

    const badType = await t.http().put(`${base}/keys/A`).set(member).send({ type: 'date' });
    expect(badType.status).toBe(400);
  });

  it('공개 접두사는 관리자만 정한다', async () => {
    const byMember = await t
      .http()
      .put(`${base}/public-prefixes`)
      .set(member)
      .send({ publicPrefixes: ['VITE_'] });
    expect(byMember.status).toBe(403);

    const byAdmin = await t
      .http()
      .put(`${base}/public-prefixes`)
      .set(admin)
      .send({ publicPrefixes: ['VITE_'] });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body).toEqual({ publicPrefixes: ['VITE_'] });
    expect((await t.http().get(base).set(member)).body.publicPrefixes).toEqual(['VITE_']);

    const invalid = await t
      .http()
      .put(`${base}/public-prefixes`)
      .set(admin)
      .send({ publicPrefixes: ['vite'] });
    expect(invalid.status).toBe(422);
    expect(invalid.body).toMatchObject({ code: 'invalid_public_prefix' });
  });

  it('없는 프로젝트는 404, 인증 없이는 401이다', async () => {
    expect((await t.http().get('/api/v1/projects/ghost/schema').set(member)).status).toBe(404);
    expect((await t.http().get(base)).status).toBe(401);
  });
});
