import { randomUUID } from 'node:crypto';
import type { TargetResource } from '@senv/core';
import { type Envelope, type Keyring, openEnvelope, sealEnvelope } from '../crypto/envelope.js';
import { isUniqueViolation } from '../database/errors.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { type AnyProvider, type TargetRegistry, UnknownProviderError } from './target-registry.js';

export { UnknownProviderError };

export interface ConnectionView {
  id: string;
  name: string;
  type: string;
  /** 비밀 필드를 뺀 설정 (예: Coolify 주소) */
  config: Record<string, unknown>;
  mappingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export class ConnectionNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`배포 대상 연결이 없습니다: ${id}`);
    this.name = 'ConnectionNotFoundError';
  }
}

export class ConnectionNameTakenError extends Error {
  constructor(readonly connectionName: string) {
    super(`이미 있는 연결 이름입니다: ${connectionName}`);
    this.name = 'ConnectionNameTakenError';
  }
}

export class ConnectionInUseError extends Error {
  constructor(readonly connectionName: string) {
    super(`매핑이 있는 연결은 지울 수 없습니다. 매핑을 먼저 지우세요: ${connectionName}`);
    this.name = 'ConnectionInUseError';
  }
}

const aad = (id: string) => `target-connection:${id}`;

/**
 * 배포 대상 연결 (PRD 8.1, 결정 52). 저장하기 전에 연결을 확인하고,
 * 설정은 KEK 봉투로 암호화한다. 비밀 필드는 다시 보여주지 않고 교체만 한다.
 */
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: TargetRegistry,
    private readonly keyring: Keyring,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<ConnectionView[]> {
    const rows = await this.prisma.targetConnection.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { mappings: true } } },
    });
    return rows.map((row) => this.toView(row, row._count.mappings));
  }

  async create(
    input: { name: string; type: string; config: unknown },
    actor: string,
  ): Promise<ConnectionView> {
    const provider = this.registry.get(input.type);
    const connection = provider.parseConnection(input.config);
    await provider.testConnection(connection);
    const id = randomUUID();
    const now = this.now();
    try {
      const row = await this.prisma.targetConnection.create({
        data: {
          id,
          name: input.name.trim(),
          type: input.type,
          config: this.seal(id, connection),
          createdBy: actor,
          createdAt: now,
          updatedAt: now,
        },
      });
      return this.toView(row, 0);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConnectionNameTakenError(input.name);
      throw error;
    }
  }

  /** 비밀 필드를 비워 보내면 저장된 값을 그대로 쓴다 */
  async update(id: string, input: { name?: string; config?: unknown }): Promise<ConnectionView> {
    const { row, provider, connection: current } = await this.load(id);
    let config = row.config;
    if (input.config !== undefined) {
      const merged = { ...(input.config as Record<string, unknown>) };
      for (const field of provider.connectionFields) {
        if (
          field.kind === 'secret' &&
          (merged[field.name] === undefined || merged[field.name] === '')
        ) {
          merged[field.name] = (current as Record<string, unknown>)[field.name];
        }
      }
      const connection = provider.parseConnection(merged);
      await provider.testConnection(connection);
      config = this.seal(id, connection);
    }
    try {
      const updated = await this.prisma.targetConnection.update({
        where: { id },
        data: { ...(input.name ? { name: input.name.trim() } : {}), config, updatedAt: this.now() },
        include: { _count: { select: { mappings: true } } },
      });
      return this.toView(updated, updated._count.mappings);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConnectionNameTakenError(input.name ?? '');
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const row = await this.prisma.targetConnection.findUnique({
      where: { id },
      include: { _count: { select: { mappings: true } } },
    });
    if (!row) throw new ConnectionNotFoundError(id);
    if (row._count.mappings > 0) throw new ConnectionInUseError(row.name);
    await this.prisma.targetConnection.delete({ where: { id } });
  }

  async test(id: string): Promise<void> {
    const { provider, connection } = await this.open(id);
    await provider.testConnection(connection);
  }

  async resources(id: string): Promise<TargetResource[]> {
    const { provider, connection } = await this.open(id);
    return provider.listResources(connection);
  }

  /** 동기화 엔진이 제공자를 부를 때 쓴다. 복호화한 설정은 호출할 때마다 넘긴다 */
  async open(id: string): Promise<{ provider: AnyProvider; connection: unknown }> {
    const { provider, connection } = await this.load(id);
    return { provider, connection };
  }

  private async load(id: string) {
    const row = await this.prisma.targetConnection.findUnique({ where: { id } });
    if (!row) throw new ConnectionNotFoundError(id);
    const provider = this.registry.get(row.type);
    const envelope = JSON.parse(row.config) as Envelope;
    const connection = provider.parseConnection(
      JSON.parse(openEnvelope(envelope, aad(id), this.keyring)),
    );
    return { row, provider, connection };
  }

  private seal(id: string, connection: unknown): string {
    return JSON.stringify(sealEnvelope(JSON.stringify(connection), aad(id), this.keyring));
  }

  private toView(
    row: {
      id: string;
      name: string;
      type: string;
      config: string;
      createdAt: Date;
      updatedAt: Date;
    },
    mappingCount: number,
  ): ConnectionView {
    const provider = this.registry.get(row.type);
    const connection = JSON.parse(
      openEnvelope(JSON.parse(row.config) as Envelope, aad(row.id), this.keyring),
    ) as Record<string, unknown>;
    const secrets = new Set(
      provider.connectionFields
        .filter((field) => field.kind === 'secret')
        .map((field) => field.name),
    );
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      config: Object.fromEntries(Object.entries(connection).filter(([key]) => !secrets.has(key))),
      mappingCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
