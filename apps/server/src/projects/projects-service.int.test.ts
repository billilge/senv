import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import {
  InvalidProjectNameError,
  ProjectNameTakenError,
  ProjectNotFoundError,
  ProjectsService,
  ReservedProjectNameError,
} from './projects-service.js';

const prisma = createTestPrisma();
const service = new ProjectsService(prisma);

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe('ProjectsService', () => {
  describe('create', () => {
    it('프로젝트를 만들면 local·development·production 환경이 함께 생긴다', async () => {
      const project = await service.create({ name: 'server', displayName: 'Stream API' });
      expect(project).toEqual({
        name: 'server',
        displayName: 'Stream API',
        kind: 'app',
        environments: ['local', 'development', 'production'],
      });
      expect(await prisma.environment.count()).toBe(3);
    });

    it('표시 이름을 주지 않으면 프로젝트 이름을 쓴다', async () => {
      expect((await service.create({ name: 'web' })).displayName).toBe('web');
    });

    it.each(['Server', 'web_admin', 'x'.repeat(33), ''])(
      '이름 규칙에 어긋나면(%s) InvalidProjectNameError이고 아무것도 남지 않는다',
      async (name) => {
        await expect(service.create({ name })).rejects.toThrow(InvalidProjectNameError);
        expect(await prisma.project.count()).toBe(0);
      },
    );

    it('shared는 공유 그룹용 예약 이름이라 일반 프로젝트로 만들 수 없다', async () => {
      await expect(service.create({ name: 'shared' })).rejects.toThrow(ReservedProjectNameError);
    });

    it('같은 이름이 있으면 ProjectNameTakenError다', async () => {
      await service.create({ name: 'server' });
      await expect(service.create({ name: 'server' })).rejects.toThrow(ProjectNameTakenError);
    });

    it('같은 이름으로 동시에 만들어도 하나만 생기고 나머지는 ProjectNameTakenError다', async () => {
      const results = await Promise.allSettled([
        service.create({ name: 'app' }),
        service.create({ name: 'app' }),
        service.create({ name: 'app' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const result of results.filter((r) => r.status === 'rejected')) {
        expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ProjectNameTakenError);
      }
      expect(await prisma.project.count()).toBe(1);
      expect(await prisma.environment.count()).toBe(3);
    });
  });

  describe('조회', () => {
    it('list는 일반 프로젝트만 이름 순으로 돌려준다 (공유 프로젝트 제외)', async () => {
      await service.ensureSharedProject();
      await service.create({ name: 'web' });
      await service.create({ name: 'app' });
      expect((await service.list()).map((p) => p.name)).toEqual(['app', 'web']);
    });

    it('get은 이름으로 프로젝트를 찾는다', async () => {
      await service.create({ name: 'server', displayName: 'Stream API' });
      expect((await service.get('server')).displayName).toBe('Stream API');
    });

    it('없는 프로젝트를 get하면 ProjectNotFoundError다', async () => {
      await expect(service.get('ghost')).rejects.toThrow(ProjectNotFoundError);
    });
  });

  describe('ensureSharedProject', () => {
    it('공유 프로젝트가 없으면 세 환경과 함께 만든다', async () => {
      expect(await service.ensureSharedProject()).toEqual({
        name: 'shared',
        displayName: '공유 그룹',
        kind: 'shared',
        environments: ['local', 'development', 'production'],
      });
    });

    it('여러 번, 동시에 불러도 공유 프로젝트는 하나뿐이다', async () => {
      await Promise.all([
        service.ensureSharedProject(),
        service.ensureSharedProject(),
        service.ensureSharedProject(),
      ]);
      await service.ensureSharedProject();
      expect(await prisma.project.count({ where: { kind: 'shared' } })).toBe(1);
      expect(await prisma.environment.count()).toBe(3);
    });
  });
});
