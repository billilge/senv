import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type TestApp } from '../testing/app.js';
import { resetDatabase } from '../testing/database.js';

let t: TestApp;
let admin: { userId: string; auth: { Authorization: string } };

beforeAll(async () => {
  t = await createTestApp();
});
beforeEach(async () => {
  await resetDatabase(t.prisma);
  admin = await signIn(t, { login: 'admin', role: 'admin' });
});
afterAll(() => t.close());

describe('사용자 관리 API', () => {
  it('관리자는 사용자 목록을 승인 대기 먼저 본다', async () => {
    await signIn(t, { login: 'zed' });
    await signIn(t, { login: 'newbie', status: 'pending' });

    const response = await t.http().get('/api/v1/users').set(admin.auth);
    expect(response.status).toBe(200);
    expect(response.body.users.map((u: { login: string }) => u.login)).toEqual([
      'newbie',
      'admin',
      'zed',
    ]);
  });

  it('멤버는 사용자 관리 API를 쓸 수 없다 (403 admin_required)', async () => {
    const member = await signIn(t, { login: 'bob' });
    const response = await t.http().get('/api/v1/users').set(member.auth);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('admin_required');
  });

  it('승인하면 승인 대기 사용자가 바로 API를 쓸 수 있다', async () => {
    const newbie = await signIn(t, { login: 'newbie', status: 'pending' });
    expect((await t.http().get('/api/v1/projects').set(newbie.auth)).status).toBe(403);

    const approved = await t.http().post(`/api/v1/users/${newbie.userId}/activate`).set(admin.auth);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('active');
    expect((await t.http().get('/api/v1/projects').set(newbie.auth)).status).toBe(200);
  });

  it('비활성화하면 그 사용자의 토큰이 즉시 막힌다', async () => {
    const bob = await signIn(t, { login: 'bob' });
    const disabled = await t.http().post(`/api/v1/users/${bob.userId}/disable`).set(admin.auth);
    expect(disabled.body.status).toBe('disabled');
    expect((await t.http().get('/api/v1/projects').set(bob.auth)).status).toBe(401);
  });

  it('역할을 바꿀 수 있고, 마지막 관리자는 내릴 수 없다', async () => {
    const bob = await signIn(t, { login: 'bob' });
    const promoted = await t
      .http()
      .put(`/api/v1/users/${bob.userId}/role`)
      .set(admin.auth)
      .send({ role: 'admin' });
    expect(promoted.body.role).toBe('admin');

    await t.http().put(`/api/v1/users/${bob.userId}/role`).set(admin.auth).send({ role: 'member' });
    const last = await t
      .http()
      .put(`/api/v1/users/${admin.userId}/role`)
      .set(admin.auth)
      .send({ role: 'member' });
    expect(last.status).toBe(422);
    expect(last.body.code).toBe('last_admin');
  });

  it('자기 자신은 비활성화할 수 없다 (422 cannot_disable_self)', async () => {
    await signIn(t, { login: 'second', role: 'admin' });
    const response = await t.http().post(`/api/v1/users/${admin.userId}/disable`).set(admin.auth);
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('cannot_disable_self');
  });

  it('역할 값이 틀리면 400, 없는 사용자는 404다', async () => {
    const bob = await signIn(t, { login: 'bob' });
    const invalid = await t
      .http()
      .put(`/api/v1/users/${bob.userId}/role`)
      .set(admin.auth)
      .send({ role: 'owner' });
    expect(invalid.status).toBe(400);

    const missing = await t.http().post('/api/v1/users/no-such-user/activate').set(admin.auth);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('user_not_found');
  });

  it('관리자는 GitHub 사용자명으로 역할을 미리 지정하고, 목록을 보고, 지운다', async () => {
    const put = await t
      .http()
      .put('/api/v1/role-assignments/Carol')
      .set(admin.auth)
      .send({ role: 'admin' });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ login: 'carol', role: 'admin', createdAt: expect.any(String) });

    const list = await t.http().get('/api/v1/role-assignments').set(admin.auth);
    expect(list.body).toEqual({ assignments: [put.body] });

    expect((await t.http().delete('/api/v1/role-assignments/carol').set(admin.auth)).status).toBe(
      204,
    );
    const missing = await t.http().delete('/api/v1/role-assignments/carol').set(admin.auth);
    expect(missing.body).toMatchObject({ code: 'assignment_not_found' });
  });

  it('이미 로그인한 사용자면 409 user_exists, 형식이 틀리면 422, 멤버는 403이다', async () => {
    const member = await signIn(t, { login: 'zed' });
    const exists = await t
      .http()
      .put('/api/v1/role-assignments/zed')
      .set(admin.auth)
      .send({ role: 'admin' });
    expect(exists.status).toBe(409);
    expect(exists.body).toMatchObject({ code: 'user_exists' });

    const invalid = await t
      .http()
      .put('/api/v1/role-assignments/-bad-')
      .set(admin.auth)
      .send({ role: 'member' });
    expect(invalid.status).toBe(422);

    expect((await t.http().get('/api/v1/role-assignments').set(member.auth)).status).toBe(403);
  });
});
