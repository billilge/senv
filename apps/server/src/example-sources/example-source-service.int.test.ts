import { SHARED_PROJECT_NAME } from '@senv/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { KeySchemaService } from '../key-schemas/key-schema-service.js';
import { ProjectNotFoundError, ProjectsService } from '../projects/projects-service.js';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { FakeGitHubAppClient } from '../testing/fake-github-app.js';
import {
  ExampleFileNotFoundError,
  ExampleSourceNotFoundError,
  ExampleSourceService,
  GitHubAppDisabledError,
  InvalidExamplePathError,
  RepositoryNotInstalledError,
  SharedGroupNoExampleError,
} from './example-source-service.js';

const prisma = createTestPrisma();
let now = new Date('2026-10-09T09:00:00.000Z');
const schemas = new KeySchemaService(prisma, () => now);
let github: FakeGitHubAppClient;
let service: ExampleSourceService;

/** 저장소 id는 32비트 정수 범위를 넘을 수 있다 */
const REPO = { id: 2_200_000_001, fullName: 'billilge/stream-web', installationId: 77 };
const EXAMPLE = [
  '# API 주소',
  'VITE_API_URL=https://api.example',
  '',
  '# 캐시',
  'REDIS_URL=',
  'API_TOKEN=real-looking-secret',
  'lower_key=1',
].join('\n');

const link = (path = '.env.example', project = 'web') =>
  service.link(project, { repoId: REPO.id, path }, 'u1');
const keyNames = async (project = 'web') =>
  (await schemas.get(project)).keys.map((entry) => entry.key);

beforeEach(async () => {
  await resetDatabase(prisma);
  now = new Date('2026-10-09T09:00:00.000Z');
  const projects = new ProjectsService(prisma);
  await projects.create({ name: 'web' });
  await projects.create({ name: 'admin' });
  await projects.ensureSharedProject();
  await schemas.setPublicPrefixes('web', ['VITE_']);
  await schemas.put('web', 'API_TOKEN', { required: true, description: '원래 설명' }, 'u1');
  github = new FakeGitHubAppClient()
    .addRepository(REPO)
    .setFile(REPO.fullName, '.env.example', EXAMPLE);
  service = new ExampleSourceService(prisma, schemas, github, () => now);
});
afterAll(() => prisma.$disconnect());

describe('ExampleSourceService.link', () => {
  it('연결하면 바로 읽어 스키마에 없는 키만 등록하고 상태를 돌려준다', async () => {
    const view = await link();

    expect(view).toEqual({
      repoId: REPO.id,
      repoFullName: 'billilge/stream-web',
      path: '.env.example',
      fileUrl: 'https://github.com/billilge/stream-web/blob/HEAD/.env.example',
      lastResult: 'ok',
      lastMessage: null,
      lastCheckedAt: now,
      keys: ['API_TOKEN', 'REDIS_URL', 'VITE_API_URL'],
      lastAdded: ['REDIS_URL', 'VITE_API_URL'],
      lastRemoved: [],
      skipped: [{ line: 7, reason: 'invalid_key' }],
    });
    expect(await service.get('web')).toEqual(view);
    expect(await service.get('admin')).toBeNull();

    expect((await schemas.get('web')).keys).toEqual([
      expect.objectContaining({ key: 'API_TOKEN', required: true, description: '원래 설명' }),
      expect.objectContaining({
        key: 'REDIS_URL',
        visibility: 'secret',
        required: false,
        description: '캐시',
      }),
      expect.objectContaining({
        key: 'VITE_API_URL',
        visibility: 'public',
        description: 'API 주소',
      }),
    ]);
  });

  it('예시 값은 어디에도 남기지 않는다', async () => {
    await link();
    const row = await prisma.exampleSource.findFirstOrThrow();
    const stored = JSON.stringify(row, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(stored).not.toMatch(/real-looking-secret|api\.example/);
  });

  it('경로 앞의 / 와 ./ 는 떼고 저장한다', async () => {
    github.setFile(REPO.fullName, 'apps/web/.env.example', 'A=');
    expect((await link('/apps/web/.env.example')).path).toBe('apps/web/.env.example');
    expect((await link('./apps/web/.env.example')).path).toBe('apps/web/.env.example');
  });

  it('연결을 바꾸면 새 파일을 처음부터 읽는다 (이전 파일의 키를 빠진 키로 알리지 않는다)', async () => {
    await link();
    github.setFile(REPO.fullName, 'other/.env.example', 'ONLY_KEY=');
    const view = await link('other/.env.example');
    expect(view).toMatchObject({ keys: ['ONLY_KEY'], lastAdded: ['ONLY_KEY'], lastRemoved: [] });
    expect(await prisma.exampleSource.count()).toBe(1);
  });

  it('연결할 수 없으면 아무것도 저장하지 않는다', async () => {
    for (const path of ['', '   ', '../.env.example', 'apps/../../x', 'apps/']) {
      await expect(link(path)).rejects.toThrow(InvalidExamplePathError);
    }
    await expect(link('.env.example', SHARED_PROJECT_NAME)).rejects.toThrow(
      SharedGroupNoExampleError,
    );
    await expect(link('.env.example', 'ghost')).rejects.toThrow(ProjectNotFoundError);
    await expect(service.link('web', { repoId: 1, path: '.env.example' }, 'u1')).rejects.toThrow(
      RepositoryNotInstalledError,
    );
    await expect(link('missing/.env.example')).rejects.toThrow(ExampleFileNotFoundError);

    const off = new ExampleSourceService(prisma, schemas, null, () => now);
    await expect(off.link('web', { repoId: REPO.id, path: '.env.example' }, 'u1')).rejects.toThrow(
      GitHubAppDisabledError,
    );

    expect(await prisma.exampleSource.count()).toBe(0);
    expect(await keyNames()).toEqual(['API_TOKEN']);
  });
});

describe('ExampleSourceService.check', () => {
  it('파일이 그대로면 다시 등록하지 않고 확인 시각만 바꾼다', async () => {
    await link();
    now = new Date('2026-10-09T10:00:00.000Z');

    const view = await service.check('web', 'u2');

    expect(view).toMatchObject({
      lastResult: 'ok',
      lastCheckedAt: now,
      lastAdded: ['REDIS_URL', 'VITE_API_URL'],
    });
  });

  it('키가 더해지고 빠지면 새 키만 등록하고, 빠진 키는 지우지 않고 알린다', async () => {
    await link();
    github.setFile(REPO.fullName, '.env.example', 'VITE_API_URL=\nAPI_TOKEN=\nNEW_KEY=\n');

    const view = await service.check('web', 'u2');

    expect(view).toMatchObject({
      keys: ['API_TOKEN', 'NEW_KEY', 'VITE_API_URL'],
      lastAdded: ['NEW_KEY'],
      lastRemoved: ['REDIS_URL'],
      skipped: [],
    });
    expect(await keyNames()).toEqual(['API_TOKEN', 'NEW_KEY', 'REDIS_URL', 'VITE_API_URL']);
    const row = await prisma.keySchema.findFirstOrThrow({ where: { key: 'NEW_KEY' } });
    expect(row.updatedBy).toBe('u2');
  });

  it('읽지 못하면 결과와 이유를 남기고, 마지막으로 읽은 키는 그대로 둔다', async () => {
    await link();

    github.setFile(REPO.fullName, '.env.example', null);
    expect(await service.check('web', 'u1')).toMatchObject({
      lastResult: 'not_found',
      lastMessage: expect.stringContaining('.env.example'),
      keys: ['API_TOKEN', 'REDIS_URL', 'VITE_API_URL'],
    });

    github.setFile(REPO.fullName, '.env.example', `A=${'x'.repeat(64 * 1024)}`);
    expect(await service.check('web', 'u1')).toMatchObject({
      lastResult: 'too_large',
      lastMessage: expect.stringContaining('64KB'),
    });

    github.denied = true;
    expect(await service.check('web', 'u1')).toMatchObject({
      lastResult: 'no_access',
      lastMessage: expect.any(String),
    });

    github.denied = false;
    github.unavailable = true;
    expect(await service.check('web', 'u1')).toMatchObject({
      lastResult: 'error',
      lastMessage: expect.any(String),
    });
    expect(await keyNames()).toEqual(['API_TOKEN', 'REDIS_URL', 'VITE_API_URL']);
  });

  it('동시에 확인해도 한 번만 처리한다', async () => {
    await link();
    github.setFile(REPO.fullName, '.env.example', `${EXAMPLE}\nNEW_KEY=`);

    await Promise.all([service.check('web', 'u1'), service.check('web', 'u1')]);

    expect(await service.get('web')).toMatchObject({ lastAdded: ['NEW_KEY'] });
  });

  it('연결이 없으면 ExampleSourceNotFoundError다', async () => {
    await expect(service.check('web', 'u1')).rejects.toThrow(ExampleSourceNotFoundError);
  });
});

describe('ExampleSourceService.handlePush', () => {
  const push = (overrides: Partial<Parameters<ExampleSourceService['handlePush']>[0]> = {}) =>
    service.handlePush({
      ref: 'refs/heads/main',
      repository: { id: REPO.id, fullName: REPO.fullName, defaultBranch: 'main' },
      installationId: REPO.installationId,
      sender: 'alice',
      ...overrides,
    });

  it('기본 브랜치에 푸시되면 그 저장소에 연결된 프로젝트를 모두 확인한다', async () => {
    github.setFile(REPO.fullName, 'apps/admin/.env.example', 'ADMIN_KEY=');
    await link();
    await link('apps/admin/.env.example', 'admin');
    github.setFile(REPO.fullName, '.env.example', `${EXAMPLE}\nWEB_NEW=`);
    github.setFile(REPO.fullName, 'apps/admin/.env.example', 'ADMIN_KEY=\nADMIN_NEW=');

    expect(await push()).toBe(2);

    expect(await service.get('web')).toMatchObject({ lastAdded: ['WEB_NEW'] });
    expect(await service.get('admin')).toMatchObject({ lastAdded: ['ADMIN_NEW'] });
    const row = await prisma.keySchema.findFirstOrThrow({ where: { key: 'WEB_NEW' } });
    expect(row.updatedBy).toBe('github:alice');
  });

  it('기본 브랜치가 아니거나 연결되지 않은 저장소면 읽지 않는다', async () => {
    await link();
    const reads = github.reads.length;

    expect(await push({ ref: 'refs/heads/feature' })).toBe(0);
    expect(
      await push({ repository: { id: 999, fullName: 'billilge/other', defaultBranch: 'main' } }),
    ).toBe(0);
    expect(github.reads).toHaveLength(reads);
  });

  it('저장소 이름이 바뀌었으면 새 이름으로 고쳐 읽는다', async () => {
    await link();
    const renamed = { ...REPO, fullName: 'billilge/web' };
    github.addRepository(renamed).setFile(renamed.fullName, '.env.example', 'RENAMED_KEY=');

    await push({ repository: { id: REPO.id, fullName: renamed.fullName, defaultBranch: 'main' } });

    expect(await service.get('web')).toMatchObject({
      repoFullName: 'billilge/web',
      lastAdded: ['RENAMED_KEY'],
    });
  });
});

describe('ExampleSourceService.unlink', () => {
  it('연결을 끊어도 등록된 키는 남는다. 연결이 없으면 ExampleSourceNotFoundError다', async () => {
    await link();
    await service.unlink('web');

    expect(await service.get('web')).toBeNull();
    expect(await keyNames()).toEqual(['API_TOKEN', 'REDIS_URL', 'VITE_API_URL']);
    await expect(service.unlink('web')).rejects.toThrow(ExampleSourceNotFoundError);
  });
});
