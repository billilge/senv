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
    await expect(service.addMissing('ghost', [], 'u1')).rejects.toThrow(ProjectNotFoundError);
  });
});

describe('KeySchemaService.addMissing (.env.example 등록, 결정 74)', () => {
  it('없는 키만 등록하고 새로 등록한 키 이름을 돌려준다. 이미 있는 키의 속성은 그대로다', async () => {
    await service.put('web', 'API_URL', { type: 'url', required: true, description: '원래' }, 'u1');

    const added = await service.addMissing(
      'web',
      [
        { key: 'API_URL', visibility: 'secret', description: '예시의 설명' },
        { key: 'VITE_DSN', visibility: 'public', description: 'Sentry' },
        { key: 'REDIS_URL', visibility: 'secret', description: '' },
      ],
      'github:alice',
    );

    expect(added).toEqual(['REDIS_URL', 'VITE_DSN']);
    expect((await service.get('web')).keys).toEqual([
      expect.objectContaining({ key: 'API_URL', type: 'url', required: true, description: '원래' }),
      {
        key: 'REDIS_URL',
        type: 'string',
        visibility: 'secret',
        required: false,
        optionalIn: [],
        buildTime: false,
        description: '',
      },
      expect.objectContaining({ key: 'VITE_DSN', visibility: 'public', description: 'Sentry' }),
    ]);
    const row = await prisma.keySchema.findFirstOrThrow({ where: { key: 'REDIS_URL' } });
    expect(row).toMatchObject({ updatedBy: 'github:alice', updatedAt: NOW });
  });

  it('동시에 같은 키를 등록해도 한 번만 들어간다', async () => {
    const keys = [{ key: 'A', visibility: 'secret' as const, description: '' }];
    await Promise.all([
      service.addMissing('web', keys, 'u1'),
      service.addMissing('web', keys, 'u2'),
    ]);
    expect((await service.get('web')).keys.map((entry) => entry.key)).toEqual(['A']);
  });

  it('키 이름이 규칙에 맞지 않으면 아무것도 등록하지 않는다', async () => {
    await expect(
      service.addMissing('web', [{ key: 'bad', visibility: 'secret', description: '' }], 'u1'),
    ).rejects.toThrow(InvalidKeyNameError);
    expect((await service.get('web')).keys).toEqual([]);
  });
});
