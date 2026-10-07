// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 쓴다
import { randomBytes } from 'node:crypto';
import { ChangeSetConflictError } from '@senv/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Envelope, Keyring } from '../crypto/envelope.js';
import { Prisma } from '../generated/prisma/client.js';
import { KeySchemaService } from '../key-schemas/key-schema-service.js';
import { ProjectNotFoundError, ProjectsService } from '../projects/projects-service.js';
import { SnapshotService } from '../snapshots/snapshot-service.js';
import { InMemorySnapshotStore } from '../storage/in-memory-snapshot-store.js';
import type { SnapshotRef } from '../storage/snapshot-store.js';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { createTestUser } from '../testing/users.js';
import { forceCurrentVersion } from '../testing/versions.js';
import {
  InvalidEnvironmentError,
  NoChangesError,
  type PublishInput,
  PublishService,
  PublishValidationError,
  VersionConflictError,
  VersionNotFoundError,
} from './publish-service.js';

const prisma = createTestPrisma();
const keyring: Keyring = { currentKekId: 'kek-1', keks: new Map([['kek-1', randomBytes(32)]]) };
const NOW = new Date('2026-10-07T09:00:00.000Z');

let store: InMemorySnapshotStore;
let snapshots: SnapshotService;
let service: PublishService;

beforeEach(async () => {
  await resetDatabase(prisma);
  store = new InMemorySnapshotStore();
  snapshots = new SnapshotService(store, keyring);
  service = new PublishService(prisma, snapshots, () => NOW);
  const projects = new ProjectsService(prisma);
  await projects.create({ name: 'server' });
  await projects.ensureSharedProject();
});
afterAll(() => prisma.$disconnect());

function publish(overrides: Partial<PublishInput> = {}) {
  return service.publish({
    project: 'server',
    env: 'production',
    baseVersion: 0,
    changes: { set: { A: '1' } },
    message: '테스트',
    actor: 'user_1',
    ...overrides,
  });
}

const serverProd = (version: number): SnapshotRef => ({
  scope: 'project',
  project: 'server',
  env: 'production',
  version,
});

async function currentVersionOf(project: string, env: 'local' | 'development' | 'production') {
  const row = await prisma.environment.findFirstOrThrow({
    where: { name: env, project: { name: project } },
  });
  return row.currentVersion;
}

describe('PublishService.publish', () => {
  it('첫 게시는 기준 버전 0에서 v1을 만들고 값과 기록을 남긴다', async () => {
    const result = await publish({ changes: { set: { A: '1', B: '2' } }, message: '첫 게시' });

    expect(result).toEqual({
      version: 1,
      diff: { added: ['A', 'B'], removed: [], changed: [], unchanged: [] },
    });
    expect(await service.getCurrent('server', 'production')).toEqual({
      version: 1,
      variables: { A: '1', B: '2' },
    });
    expect(
      await prisma.environmentVersion.findMany({
        select: { version: true, createdBy: true, message: true, createdAt: true },
      }),
    ).toEqual([{ version: 1, createdBy: 'user_1', message: '첫 게시', createdAt: NOW }]);
  });

  it('이어서 게시하면 현재 값에 변경 집합을 적용한 다음 버전을 만들고, 이전 스냅샷은 그대로 둔다', async () => {
    await publish({ changes: { set: { A: '1', B: '2', C: '3' } } });
    const result = await publish({ baseVersion: 1, changes: { set: { A: '10' }, remove: ['C'] } });

    expect(result).toEqual({
      version: 2,
      diff: { added: [], removed: ['C'], changed: ['A'], unchanged: ['B'] },
    });
    expect((await service.getCurrent('server', 'production')).variables).toEqual({
      A: '10',
      B: '2',
    });
    expect((await snapshots.load(serverProd(1))).variables).toEqual({ A: '1', B: '2', C: '3' });
  });

  it('message를 생략하면 빈 문자열로 남긴다', async () => {
    await publish({ message: undefined });
    expect((await prisma.environmentVersion.findFirstOrThrow()).message).toBe('');
  });

  describe('충돌과 거부', () => {
    it('기준 버전이 현재 버전과 다르면 VersionConflictError이고 아무것도 바뀌지 않는다', async () => {
      await publish();
      const attempt = publish({ baseVersion: 0, changes: { set: { A: '2' } } });

      await expect(attempt).rejects.toThrow(VersionConflictError);
      await expect(attempt).rejects.toMatchObject({ baseVersion: 0, currentVersion: 1 });
      expect(await currentVersionOf('server', 'production')).toBe(1);
      expect(await store.listVersions(serverProd(1))).toEqual([1]);
    });

    it('같은 기준 버전으로 동시에 게시하면 하나만 성공하고 나머지는 VersionConflictError다', async () => {
      const results = await Promise.allSettled(
        ['x', 'y', 'z'].map((value) => publish({ changes: { set: { A: value } } })),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const result of results.filter((r) => r.status === 'rejected')) {
        expect((result as PromiseRejectedResult).reason).toBeInstanceOf(VersionConflictError);
      }
      expect(await currentVersionOf('server', 'production')).toBe(1);
      expect(await prisma.environmentVersion.count()).toBe(1);
      expect(await store.listVersions(serverProd(1))).toEqual([1]);
    });

    it.each([
      ['빈 변경 집합', {}],
      ['같은 값으로 설정', { set: { A: '1' } }],
      ['없는 키 삭제', { remove: ['GHOST'] }],
    ])('바뀐 값이 없으면(%s) NoChangesError다', async (_label, changes) => {
      await publish();
      await expect(publish({ baseVersion: 1, changes })).rejects.toThrow(NoChangesError);
      expect(await currentVersionOf('server', 'production')).toBe(1);
    });

    it('같은 키를 set과 remove에 함께 넣으면 ChangeSetConflictError다', async () => {
      await expect(publish({ changes: { set: { A: '1' }, remove: ['A'] } })).rejects.toThrow(
        ChangeSetConflictError,
      );
    });

    it('없는 프로젝트면 ProjectNotFoundError, 고정 환경이 아니면 InvalidEnvironmentError다', async () => {
      await expect(publish({ project: 'ghost' })).rejects.toThrow(ProjectNotFoundError);
      await expect(publish({ env: 'staging' })).rejects.toThrow(InvalidEnvironmentError);
    });
  });

  describe('게시 전 검증', () => {
    it('키 이름 규칙에 어긋나면 invalid_key_name이고 아무것도 저장하지 않는다', async () => {
      const attempt = publish({ changes: { set: { database_url: 'x', OK: '1', '2FA': 'y' } } });

      await expect(attempt).rejects.toThrow(PublishValidationError);
      await expect(attempt).rejects.toMatchObject({
        issues: [
          { code: 'invalid_key_name', key: '2FA' },
          { code: 'invalid_key_name', key: 'database_url' },
        ],
      });
      expect(await store.listVersions(serverProd(1))).toEqual([]);
      expect(await currentVersionOf('server', 'production')).toBe(0);
    });

    it('같은 환경의 공유 그룹에 있는 키는 참조할 수 있다', async () => {
      await publish({ project: 'shared', changes: { set: { API_HOST: 'api.stream.dev' } } });
      await expect(
        publish({ changes: { set: { URL: 'https://${shared.API_HOST}' } } }),
      ).resolves.toMatchObject({ version: 1 });
    });

    it('공유 그룹에 없는 키를 참조하면 missing_reference다', async () => {
      await expect(publish({ changes: { set: { URL: '${shared.NOPE}' } } })).rejects.toMatchObject({
        issues: [{ code: 'missing_reference', key: 'URL', reference: '${shared.NOPE}' }],
      });
    });

    it('다른 환경의 공유 값은 참조할 수 없다', async () => {
      await publish({ project: 'shared', changes: { set: { API_HOST: 'api.stream.dev' } } });
      await expect(
        publish({ env: 'development', changes: { set: { URL: '${shared.API_HOST}' } } }),
      ).rejects.toMatchObject({ issues: [{ code: 'missing_reference', key: 'URL' }] });
    });

    it('공유 그룹 값 안에는 ${shared.KEY} 참조를 쓸 수 없다', async () => {
      await expect(
        publish({ project: 'shared', changes: { set: { A: 'x', B: '${shared.A}' } } }),
      ).rejects.toMatchObject({ issues: [{ code: 'reference_in_shared_group', key: 'B' }] });
    });
  });

  describe('저장소와 DB가 어긋나지 않게', () => {
    it('스냅샷 저장이 실패하면 DB는 바뀌지 않는다', async () => {
      class FailingStore extends InMemorySnapshotStore {
        override async put(): Promise<void> {
          throw new Error('R2 장애');
        }
      }
      const failing = new PublishService(
        prisma,
        new SnapshotService(new FailingStore(), keyring),
        () => NOW,
      );
      await expect(
        failing.publish({
          project: 'server',
          env: 'production',
          baseVersion: 0,
          changes: { set: { A: '1' } },
          actor: 'user_1',
        }),
      ).rejects.toThrow('R2 장애');
      expect(await currentVersionOf('server', 'production')).toBe(0);
      expect(await prisma.environmentVersion.count()).toBe(0);
    });

    it('DB 기록이 실패하면 방금 저장한 스냅샷을 지운다', async () => {
      // v1 기록이 이미 있어서 게시 트랜잭션의 버전 기록이 유니크 제약에 걸리게 만든다
      const env = await prisma.environment.findFirstOrThrow({
        where: { name: 'production', project: { name: 'server' } },
      });
      await prisma.environmentVersion.create({
        data: { environmentId: env.id, version: 1, createdBy: 'x', message: '', createdAt: NOW },
      });

      class RecordingStore extends InMemorySnapshotStore {
        puts = 0;
        override async put(ref: SnapshotRef, envelope: Envelope): Promise<void> {
          this.puts++;
          await super.put(ref, envelope);
        }
      }
      const recording = new RecordingStore();
      const publisher = new PublishService(
        prisma,
        new SnapshotService(recording, keyring),
        () => NOW,
      );

      await expect(
        publisher.publish({
          project: 'server',
          env: 'production',
          baseVersion: 0,
          changes: { set: { A: '1' } },
          actor: 'user_1',
        }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
      expect(recording.puts).toBe(1);
      expect(await recording.listVersions(serverProd(1))).toEqual([]);
      expect(await currentVersionOf('server', 'production')).toBe(0);
    });
  });
});

describe('공유 그룹 게시의 영향 검사', () => {
  beforeEach(async () => {
    await new ProjectsService(prisma).create({ name: 'web' });
    await publish({
      project: 'shared',
      changes: { set: { API_HOST: 'api.stream.dev', CDN_HOST: 'cdn.stream.dev' } },
    });
  });

  it('다른 프로젝트가 참조 중인 공유 키를 지우면 breaks_reference로 막고 참조하는 곳을 알려준다', async () => {
    await publish({ changes: { set: { URL: 'https://${shared.API_HOST}' } } });
    await publish({ project: 'web', changes: { set: { VITE_API: '${shared.API_HOST}/v1' } } });

    const attempt = publish({
      project: 'shared',
      baseVersion: 1,
      changes: { remove: ['API_HOST'] },
    });
    await expect(attempt).rejects.toThrow(PublishValidationError);
    await expect(attempt).rejects.toMatchObject({
      issues: [
        {
          code: 'breaks_reference',
          project: 'server',
          key: 'URL',
          reference: '${shared.API_HOST}',
        },
        {
          code: 'breaks_reference',
          project: 'web',
          key: 'VITE_API',
          reference: '${shared.API_HOST}',
        },
      ],
    });
    expect(await currentVersionOf('shared', 'production')).toBe(1);
  });

  it('아무도 참조하지 않는 공유 키는 지울 수 있다', async () => {
    await publish({ changes: { set: { URL: 'https://${shared.API_HOST}' } } });
    await expect(
      publish({ project: 'shared', baseVersion: 1, changes: { remove: ['CDN_HOST'] } }),
    ).resolves.toMatchObject({ version: 2 });
  });

  it('공유 키의 값을 바꾸는 것은 막지 않는다', async () => {
    await publish({ changes: { set: { URL: 'https://${shared.API_HOST}' } } });
    await expect(
      publish({
        project: 'shared',
        baseVersion: 1,
        changes: { set: { API_HOST: 'new.stream.dev' } },
      }),
    ).resolves.toMatchObject({ version: 2 });
  });

  it('다른 환경에서의 참조는 영향을 받지 않는다', async () => {
    await publish({ project: 'shared', env: 'development', changes: { set: { API_HOST: 'dev' } } });
    await publish({ env: 'development', changes: { set: { URL: '${shared.API_HOST}' } } });
    await expect(
      publish({ project: 'shared', baseVersion: 1, changes: { remove: ['API_HOST'] } }),
    ).resolves.toMatchObject({ version: 2 });
  });

  it('이번 게시와 상관없이 이미 깨져 있던 참조는 게시를 막지 않는다', async () => {
    await forceCurrentVersion(
      prisma,
      snapshots,
      { project: 'server', env: 'production', version: 1 },
      { URL: '${shared.ALREADY_GONE}' },
    );
    await expect(
      publish({ project: 'shared', baseVersion: 1, changes: { remove: ['CDN_HOST'] } }),
    ).resolves.toMatchObject({ version: 2 });
  });
});

describe('PublishService.getCurrent', () => {
  it('아직 게시한 적이 없으면 버전 0과 빈 값이다', async () => {
    expect(await service.getCurrent('server', 'local')).toEqual({ version: 0, variables: {} });
  });

  it('없는 프로젝트면 ProjectNotFoundError다', async () => {
    await expect(service.getCurrent('ghost', 'local')).rejects.toThrow(ProjectNotFoundError);
  });

  it('저장소의 봉투는 평문이 아니다', async () => {
    await publish({ changes: { set: { SECRET: 'sk_live_abc' } } });
    const envelope: Envelope = await store.get(serverProd(1));
    expect(JSON.stringify(envelope)).not.toContain('sk_live_abc');
  });
});

describe('PublishService.listVersions', () => {
  it('버전을 최신부터 메시지·시각·작성자 GitHub 사용자명과 함께 돌려준다', async () => {
    const alice = await createTestUser(prisma, { login: 'alice' });
    await publish({ actor: alice.id, message: '첫 게시' });
    await publish({ actor: 'token_ci', baseVersion: 1, changes: { set: { B: '2' } }, message: '' });

    expect(await service.listVersions('server', 'production')).toEqual([
      { version: 2, message: '', createdAt: NOW, author: { id: 'token_ci', login: null } },
      { version: 1, message: '첫 게시', createdAt: NOW, author: { id: alice.id, login: 'alice' } },
    ]);
  });

  it('게시한 적이 없으면 빈 목록이다', async () => {
    expect(await service.listVersions('server', 'local')).toEqual([]);
  });
});

describe('PublishService.getVersion', () => {
  it('지난 버전의 값을 돌려준다', async () => {
    await publish({ changes: { set: { A: '1' } } });
    await publish({ baseVersion: 1, changes: { set: { A: '2' } } });

    expect(await service.getVersion('server', 'production', 1)).toEqual({
      version: 1,
      variables: { A: '1' },
    });
  });

  it.each([0, 3, -1])('없는 버전(v%i)이면 VersionNotFoundError다', async (version) => {
    await publish();
    await publish({ baseVersion: 1, changes: { set: { B: '1' } } });
    await expect(service.getVersion('server', 'production', version)).rejects.toThrow(
      VersionNotFoundError,
    );
  });
});

describe('PublishService.rollback', () => {
  async function threeVersions() {
    await publish({ changes: { set: { A: '1', B: '1' } } });
    await publish({ baseVersion: 1, changes: { set: { A: '2' } } });
    await publish({ baseVersion: 2, changes: { set: { C: '3' }, remove: ['B'] } });
  }

  it('지난 버전의 값으로 새 버전을 게시한다 (기록은 지우지 않는다)', async () => {
    await threeVersions();

    const result = await service.rollback({
      project: 'server',
      env: 'production',
      toVersion: 1,
      baseVersion: 3,
      actor: 'user_1',
    });

    expect(result).toEqual({
      version: 4,
      diff: { added: ['B'], removed: ['C'], changed: ['A'], unchanged: [] },
    });
    expect(await service.getCurrent('server', 'production')).toEqual({
      version: 4,
      variables: { A: '1', B: '1' },
    });
    const [latest] = await service.listVersions('server', 'production');
    expect(latest?.message).toBe('v1로 되돌림');
  });

  it('메시지를 주면 그 메시지로 남긴다', async () => {
    await threeVersions();
    await service.rollback({
      project: 'server',
      env: 'production',
      toVersion: 2,
      baseVersion: 3,
      message: '배포 사고로 되돌림',
      actor: 'user_1',
    });
    const [latest] = await service.listVersions('server', 'production');
    expect(latest?.message).toBe('배포 사고로 되돌림');
  });

  it('그 사이 다른 게시가 있었으면 VersionConflictError다', async () => {
    await threeVersions();
    await expect(
      service.rollback({
        project: 'server',
        env: 'production',
        toVersion: 1,
        baseVersion: 2,
        actor: 'user_1',
      }),
    ).rejects.toThrow(VersionConflictError);
  });

  it('현재와 값이 같은 버전으로는 되돌릴 수 없다 (NoChangesError)', async () => {
    await threeVersions();
    await expect(
      service.rollback({
        project: 'server',
        env: 'production',
        toVersion: 3,
        baseVersion: 3,
        actor: 'user_1',
      }),
    ).rejects.toThrow(NoChangesError);
  });

  it('없는 버전이면 VersionNotFoundError다', async () => {
    await threeVersions();
    await expect(
      service.rollback({
        project: 'server',
        env: 'production',
        toVersion: 9,
        baseVersion: 3,
        actor: 'user_1',
      }),
    ).rejects.toThrow(VersionNotFoundError);
  });
});

describe('키 스키마 검증', () => {
  const schemas = () => new KeySchemaService(prisma, () => NOW);

  async function issuesOf(promise: Promise<unknown>) {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PublishValidationError);
    return (error as PublishValidationError).issues;
  }

  it('필수 키가 빠지면 missing_required로 막는다. 예외 환경에서는 없어도 된다', async () => {
    await schemas().put('server', 'DATABASE_URL', { required: true, optionalIn: ['local'] }, 'u1');

    expect(await issuesOf(publish({ changes: { set: { A: '1' } } }))).toEqual([
      { code: 'missing_required', key: 'DATABASE_URL' },
    ]);
    expect(await issuesOf(publish({ changes: { set: { DATABASE_URL: '' } } }))).toEqual([
      { code: 'missing_required', key: 'DATABASE_URL' },
    ]);
    await expect(publish({ env: 'local', changes: { set: { A: '1' } } })).resolves.toMatchObject({
      version: 1,
    });
  });

  it('타입이 틀리면 invalid_type으로 막는다', async () => {
    await schemas().put('server', 'PORT', { type: 'number' }, 'u1');
    await schemas().put('server', 'API_URL', { type: 'url' }, 'u1');

    expect(
      await issuesOf(publish({ changes: { set: { PORT: 'eighty', API_URL: 'localhost:3000' } } })),
    ).toEqual([
      { code: 'invalid_type', key: 'API_URL', expected: 'url' },
      { code: 'invalid_type', key: 'PORT', expected: 'number' },
    ]);
  });

  it('공유 참조는 풀어서 타입을 검사하고, 깨진 참조는 참조 문제로만 알린다', async () => {
    await schemas().put('server', 'API_URL', { type: 'url' }, 'u1');
    await publish({ project: 'shared', changes: { set: { API_HOST: 'https://api.stream.dev' } } });

    await expect(
      publish({ changes: { set: { API_URL: '${shared.API_HOST}' } } }),
    ).resolves.toMatchObject({ version: 1 });
    expect(
      await issuesOf(publish({ baseVersion: 1, changes: { set: { API_URL: '${shared.NOPE}' } } })),
    ).toEqual([{ code: 'missing_reference', key: 'API_URL', reference: '${shared.NOPE}' }]);
  });

  it('스키마에 없는 키는 막지 않는다', async () => {
    await schemas().put('server', 'A', { type: 'number' }, 'u1');
    await expect(publish({ changes: { set: { A: '1', EXTRA: 'x' } } })).resolves.toMatchObject({
      version: 1,
    });
  });
});

describe('PublishService.summarize (프로젝트 목록 요약)', () => {
  it('게시할 때 키 이름 목록을 기록에 함께 남긴다 (값은 남기지 않는다)', async () => {
    await publish({ changes: { set: { B: 'secret-b', A: 'secret-a' } } });
    const row = await prisma.environmentVersion.findFirstOrThrow();
    expect(row.keyNames).toBe('A,B');
  });

  it('환경별 현재 버전·게시 시각과, 매트릭스의 누락 칸 수(그중 필수 키)를 돌려준다', async () => {
    await publish({ env: 'production', changes: { set: { A: '1', B: '1' } } });
    await publish({ env: 'local', changes: { set: { A: '1' } } });
    // 게시한 뒤에 B를 필수로 정하면 이미 빠진 칸이 필수 누락이 된다
    await new KeySchemaService(prisma, () => NOW).put('server', 'B', { required: true }, 'u1');

    expect(await service.summarize(['server'])).toEqual(
      new Map([
        [
          'server',
          {
            environments: [
              { env: 'local', version: 1, publishedAt: NOW },
              { env: 'development', version: 0, publishedAt: null },
              { env: 'production', version: 1, publishedAt: NOW },
            ],
            // local은 B, development는 A·B가 없다. 그중 필수(B)는 두 칸
            missing: 3,
            missingRequired: 2,
          },
        ],
      ]),
    );
  });

  it('키 이름이 기록되지 않은 예전 버전은 스냅샷에서 읽는다', async () => {
    await publish({ env: 'production', changes: { set: { A: '1', B: '1' } } });
    await publish({ env: 'local', changes: { set: { A: '1' } } });
    await prisma.environmentVersion.updateMany({ data: { keyNames: null } });

    const summary = (await service.summarize(['server'])).get('server');
    expect(summary).toMatchObject({ missing: 3, missingRequired: 0 });
  });
});
