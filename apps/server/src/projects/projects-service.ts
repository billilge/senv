import {
  ENVIRONMENT_NAMES,
  type EnvironmentName,
  isValidProjectName,
  SHARED_PROJECT_NAME,
} from '@senv/core';
import { isUniqueViolation } from '../database/errors.js';
import type { PrismaClient } from '../generated/prisma/client.js';

export interface ProjectView {
  name: string;
  displayName: string;
  kind: 'app' | 'shared';
  environments: EnvironmentName[];
}

export class InvalidProjectNameError extends Error {
  constructor(readonly projectName: string) {
    super(
      `프로젝트 이름은 소문자·숫자·하이픈, 32자 이하여야 합니다: ${JSON.stringify(projectName)}`,
    );
    this.name = 'InvalidProjectNameError';
  }
}

export class ReservedProjectNameError extends Error {
  constructor(readonly projectName: string) {
    super(`예약된 프로젝트 이름입니다: ${projectName}`);
    this.name = 'ReservedProjectNameError';
  }
}

export class ProjectNameTakenError extends Error {
  constructor(readonly projectName: string) {
    super(`이미 있는 프로젝트 이름입니다: ${projectName}`);
    this.name = 'ProjectNameTakenError';
  }
}

export class ProjectNotFoundError extends Error {
  constructor(readonly projectName: string) {
    super(`프로젝트가 없습니다: ${projectName}`);
    this.name = 'ProjectNotFoundError';
  }
}

const SHARED_DISPLAY_NAME = '공유 그룹';

const PROJECT_FIELDS = {
  name: true,
  displayName: true,
  kind: true,
  environments: { select: { name: true } },
} as const;

type ProjectRow = {
  name: string;
  displayName: string;
  kind: 'app' | 'shared';
  environments: { name: EnvironmentName }[];
};

/** 프로젝트와 고정된 세 환경을 관리한다. 공유 그룹도 kind='shared'인 프로젝트다 */
export class ProjectsService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: { name: string; displayName?: string }): Promise<ProjectView> {
    const { name } = input;
    if (!isValidProjectName(name)) throw new InvalidProjectNameError(name);
    if (name === SHARED_PROJECT_NAME) throw new ReservedProjectNameError(name);

    try {
      return await this.insert(name, input.displayName?.trim() || name, 'app');
    } catch (error) {
      if (isUniqueViolation(error)) throw new ProjectNameTakenError(name);
      throw error;
    }
  }

  /** 일반 프로젝트만 이름 순으로 돌려준다 */
  async list(): Promise<ProjectView[]> {
    const rows = await this.prisma.project.findMany({
      where: { kind: 'app' },
      orderBy: { name: 'asc' },
      select: PROJECT_FIELDS,
    });
    return rows.map(toView);
  }

  async get(name: string): Promise<ProjectView> {
    const row = await this.prisma.project.findUnique({ where: { name }, select: PROJECT_FIELDS });
    if (!row) throw new ProjectNotFoundError(name);
    return toView(row);
  }

  /** 공유 프로젝트가 없으면 만든다. 동시에 불려도 하나만 생긴다 */
  async ensureSharedProject(): Promise<ProjectView> {
    try {
      return await this.insert(SHARED_PROJECT_NAME, SHARED_DISPLAY_NAME, 'shared');
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.get(SHARED_PROJECT_NAME);
    }
  }

  /** 프로젝트와 세 환경을 한 트랜잭션으로 만든다 */
  private async insert(name: string, displayName: string, kind: 'app' | 'shared') {
    const row = await this.prisma.project.create({
      data: {
        name,
        displayName,
        kind,
        environments: { create: ENVIRONMENT_NAMES.map((env) => ({ name: env })) },
      },
      select: PROJECT_FIELDS,
    });
    return toView(row);
  }
}

function toView(row: ProjectRow): ProjectView {
  const names = new Set(row.environments.map((env) => env.name));
  return {
    name: row.name,
    displayName: row.displayName,
    kind: row.kind,
    environments: ENVIRONMENT_NAMES.filter((env) => names.has(env)),
  };
}
