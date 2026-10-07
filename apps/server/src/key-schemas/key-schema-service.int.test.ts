import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ProjectNotFoundError, ProjectsService } from '../projects/projects-service.js';
import { InvalidEnvironmentError } from '../publishing/publish-service.js';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import {
  InvalidKeyNameError,
  InvalidPublicPrefixError,
  KeySchemaNotFoundError,
  KeySchemaService,
} from './key-schema-service.js';

const prisma = createTestPrisma();
const NOW = new Date('2026-10-08T09:00:00.000Z');
let service: KeySchemaService;

beforeEach(async () => {
  await resetDatabase(prisma);
  await new ProjectsService(prisma).create({ name: 'web' });
  service = new KeySchemaService(prisma, () => NOW);
});
afterAll(() => prisma.$disconnect());

describe('KeySchemaService', () => {
  it('처음에는 키 스키마도 공개 접두사도 없다', async () => {
    expect(await service.get('web')).toEqual({ publicPrefixes: [], keys: [] });
  });

  it('키를 등록하면 빠진 속성은 기본값(string, secret, 필수 아님)으로 채우고 이름 순으로 돌려준다', async () => {
    await service.put(
      'web',
      'VITE_API_URL',
      { type: 'url', visibility: 'public', required: true },
      'u1',
    );
    await service.put('web', 'API_TOKEN', {}, 'u1');

    expect(await service.get('web')).toEqual({
      publicPrefixes: [],
      keys: [
        {
          key: 'API_TOKEN',
          type: 'string',
          visibility: 'secret',
          required: false,
          optionalIn: [],
          buildTime: false,
          description: '',
        },
        {
          key: 'VITE_API_URL',
          type: 'url',
          visibility: 'public',
          required: true,
          optionalIn: [],
          buildTime: false,
          description: '',
        },
      ],
    });
  });

  it('같은 키를 다시 등록하면 속성을 바꾼다 (주지 않은 속성은 기본값으로)', async () => {
    await service.put(
      'web',
      'SENTRY_DSN',
      { type: 'url', required: true, description: 'Sentry' },
      'u1',
    );
    const updated = await service.put(
      'web',
      'SENTRY_DSN',
      { type: 'url', required: true, optionalIn: ['local', 'development'] },
      'u2',
    );

    expect(updated).toEqual({
      key: 'SENTRY_DSN',
      type: 'url',
      visibility: 'secret',
      required: true,
      optionalIn: ['local', 'development'],
      buildTime: false,
      description: '',
    });
    expect((await service.get('web')).keys).toHaveLength(1);
  });

  it('키 이름이 규칙에 맞지 않으면 InvalidKeyNameError, 환경 이름이 틀리면 InvalidEnvironmentError다', async () => {
    await expect(service.put('web', 'bad-key', {}, 'u1')).rejects.toThrow(InvalidKeyNameError);
    await expect(
      service.put('web', 'A', { optionalIn: ['staging'] as never }, 'u1'),
    ).rejects.toThrow(InvalidEnvironmentError);
  });

  it('키를 지운다. 없는 키를 지우면 KeySchemaNotFoundError다', async () => {
    await service.put('web', 'A', {}, 'u1');
    await service.remove('web', 'A');
    expect((await service.get('web')).keys).toEqual([]);
    await expect(service.remove('web', 'A')).rejects.toThrow(KeySchemaNotFoundError);
  });

  it('공개 접두사를 정한다 (중복은 한 번만)', async () => {
    expect(await service.setPublicPrefixes('web', ['VITE_', 'VITE_', 'EXPO_PUBLIC_'])).toEqual([
      'VITE_',
      'EXPO_PUBLIC_',
    ]);
    expect((await service.get('web')).publicPrefixes).toEqual(['VITE_', 'EXPO_PUBLIC_']);
    expect(await service.setPublicPrefixes('web', [])).toEqual([]);
  });

  it('공개 접두사 형식이 틀리면 InvalidPublicPrefixError다', async () => {
    await expect(service.setPublicPrefixes('web', ['vite'])).rejects.toThrow(
      InvalidPublicPrefixError,
    );
  });

  it('없는 프로젝트면 ProjectNotFoundError다', async () => {
    await expect(service.get('ghost')).rejects.toThrow(ProjectNotFoundError);
    await expect(service.put('ghost', 'A', {}, 'u1')).rejects.toThrow(ProjectNotFoundError);
  });
});
