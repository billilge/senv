import {
  ENVIRONMENT_NAMES,
  type EnvironmentName,
  isEnvironmentName,
  isValidKeyName,
  isValidPublicPrefix,
  type VariableType,
  type Visibility,
} from '@senv/core';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectNotFoundError } from '../projects/projects-service.js';
import { InvalidEnvironmentError } from '../publishing/publish-service.js';

/** 프로젝트 공통 키 속성 (PRD 5.2). 값은 환경별이고 속성은 프로젝트에 하나다 */
export interface KeySchemaView {
  key: string;
  type: VariableType;
  visibility: Visibility;
  required: boolean;
  /** required여도 값이 없어도 되는 환경 */
  optionalIn: EnvironmentName[];
  buildTime: boolean;
  description: string;
}

export type KeySchemaInput = Partial<Omit<KeySchemaView, 'key'>>;

export interface ProjectSchemaView {
  /** 클라이언트 번들에 들어가는 키의 접두사 (예: VITE_) */
  publicPrefixes: string[];
  keys: KeySchemaView[];
}

export class InvalidKeyNameError extends Error {
  constructor(readonly key: string) {
    super(
      `키 이름은 대문자·숫자·밑줄만 쓸 수 있고 숫자로 시작할 수 없습니다: ${JSON.stringify(key)}`,
    );
    this.name = 'InvalidKeyNameError';
  }
}

export class KeySchemaNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`키 스키마가 없습니다: ${key}`);
    this.name = 'KeySchemaNotFoundError';
  }
}

export class InvalidPublicPrefixError extends Error {
  constructor(readonly prefix: string) {
    super(
      `공개 접두사는 대문자로 시작하고 밑줄로 끝나야 합니다 (예: VITE_): ${JSON.stringify(prefix)}`,
    );
    this.name = 'InvalidPublicPrefixError';
  }
}

const KEY_FIELDS = {
  key: true,
  type: true,
  visibility: true,
  required: true,
  optionalIn: true,
  buildTime: true,
  description: true,
} as const;

type KeyRow = Omit<KeySchemaView, 'optionalIn'> & { optionalIn: string };

/** 쉼표로 구분해 저장한 목록 (환경 이름, 공개 접두사) */
const splitList = (value: string) => value.split(',').filter(Boolean);

const toView = (row: KeyRow): KeySchemaView => ({
  ...row,
  optionalIn: splitList(row.optionalIn).filter(isEnvironmentName),
});

export class KeySchemaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(project: string): Promise<ProjectSchemaView> {
    const row = await this.prisma.project.findUnique({
      where: { name: project },
      select: {
        publicPrefixes: true,
        keySchemas: { select: KEY_FIELDS, orderBy: { key: 'asc' } },
      },
    });
    if (!row) throw new ProjectNotFoundError(project);
    return { publicPrefixes: splitList(row.publicPrefixes), keys: row.keySchemas.map(toView) };
  }

  /** 키 속성을 등록하거나 바꾼다. 주지 않은 속성은 기본값이다 */
  async put(
    project: string,
    key: string,
    input: KeySchemaInput,
    actor: string,
  ): Promise<KeySchemaView> {
    if (!isValidKeyName(key)) throw new InvalidKeyNameError(key);
    const optionalIn = input.optionalIn ?? [];
    for (const env of optionalIn) {
      if (!isEnvironmentName(env)) throw new InvalidEnvironmentError(env);
    }
    const projectId = await this.projectId(project);
    const fields = {
      type: input.type ?? 'string',
      visibility: input.visibility ?? 'secret',
      required: input.required ?? false,
      // 환경 순서를 고정해 저장한다
      optionalIn: ENVIRONMENT_NAMES.filter((env) => optionalIn.includes(env)).join(','),
      buildTime: input.buildTime ?? false,
      description: input.description?.trim() ?? '',
      updatedAt: this.now(),
      updatedBy: actor,
    };
    const row = await this.prisma.keySchema.upsert({
      where: { projectId_key: { projectId, key } },
      create: { projectId, key, ...fields },
      update: fields,
      select: KEY_FIELDS,
    });
    return toView(row);
  }

  async remove(project: string, key: string): Promise<void> {
    const projectId = await this.projectId(project);
    const { count } = await this.prisma.keySchema.deleteMany({ where: { projectId, key } });
    if (count === 0) throw new KeySchemaNotFoundError(key);
  }

  async setPublicPrefixes(project: string, prefixes: string[]): Promise<string[]> {
    const invalid = prefixes.find((prefix) => !isValidPublicPrefix(prefix));
    if (invalid !== undefined) throw new InvalidPublicPrefixError(invalid);
    const unique = [...new Set(prefixes)];
    const projectId = await this.projectId(project);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { publicPrefixes: unique.join(',') },
    });
    return unique;
  }

  private async projectId(project: string): Promise<string> {
    const row = await this.prisma.project.findUnique({
      where: { name: project },
      select: { id: true },
    });
    if (!row) throw new ProjectNotFoundError(project);
    return row.id;
  }
}
