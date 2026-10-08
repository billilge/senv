import { isValidLocalPath, type LocalLinkState, SHARED_PROJECT_NAME } from '@senv/core';
import { isUniqueViolation } from '../database/errors.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectNotFoundError } from '../projects/projects-service.js';

export class DeviceNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`기기가 없습니다: ${id}`);
    this.name = 'DeviceNotFoundError';
  }
}

export class InvalidDeviceNameError extends Error {
  constructor() {
    super('기기 이름은 1~100자여야 합니다');
    this.name = 'InvalidDeviceNameError';
  }
}

export class InvalidLocalPathError extends Error {
  constructor() {
    super('경로는 senv.json이 있는 폴더의 절대 경로여야 합니다 (512자 이하, .. 없이)');
    this.name = 'InvalidLocalPathError';
  }
}

export class LocalLinkExistsError extends Error {
  constructor(readonly path: string) {
    super(`이 기기에 이미 같은 경로의 연결이 있습니다: ${path}`);
    this.name = 'LocalLinkExistsError';
  }
}

export class LocalLinkNotActiveError extends Error {
  constructor(readonly id: string) {
    super(`활성 상태가 아닌 연결입니다: ${id}`);
    this.name = 'LocalLinkNotActiveError';
  }
}

export class LocalLinkNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`로컬 연결이 없습니다: ${id}`);
    this.name = 'LocalLinkNotFoundError';
  }
}

export class SharedGroupNotLinkableError extends Error {
  constructor() {
    super(
      '공유 그룹은 로컬 연결을 만들지 않습니다. 공유 값은 참조하는 프로젝트의 파일에 들어갑니다',
    );
    this.name = 'SharedGroupNotLinkableError';
  }
}

export interface DeviceView {
  id: string;
  name: string;
  createdAt: Date;
  lastSeenAt: Date | null;
}

export type LocalLinkStatus = 'pending' | 'active' | 'paused';

export interface LocalLinkView {
  id: string;
  device: { id: string; name: string };
  project: string;
  path: string;
  status: LocalLinkStatus;
  approvedAt: Date | null;
  /** 프로젝트의 현재 local 버전과 공유 그룹의 현재 local 버전 */
  current: { version: number; sharedVersion: number };
  lastWritten: { version: number; sharedVersion: number; at: Date } | null;
  lastState: { state: LocalLinkState; message: string | null; at: Date } | null;
  overwriteRequested: boolean;
  createdAt: Date;
}

export interface LocalLinkInput {
  deviceId: string;
  project: string;
  path: string;
}

export interface LocalLinkReport {
  state: LocalLinkState;
  /** 사람이 읽을 설명. 값은 담지 않는다 */
  message?: string;
  /** 이번에 파일을 썼으면 그 버전 */
  written?: { version: number; sharedVersion: number };
}

const MAX_DEVICE_NAME = 100;
const MAX_MESSAGE = 300;

const LINK_INCLUDE = {
  device: { select: { id: true, name: true, userId: true } },
  project: { select: { name: true } },
} as const;

type LinkRow = {
  id: string;
  path: string;
  status: LocalLinkStatus;
  approvedAt: Date | null;
  lastWrittenVersion: number | null;
  lastWrittenSharedVersion: number | null;
  lastWrittenAt: Date | null;
  lastState: LocalLinkState | null;
  lastMessage: string | null;
  lastStateAt: Date | null;
  overwriteRequestedAt: Date | null;
  createdAt: Date;
  device: { id: string; name: string; userId: string };
  project: { name: string };
};

/**
 * 로컬 자동 받기의 기기와 연결 (M1.1, PRD 결정 60~63).
 * 남의 기기·연결은 없는 것으로 본다. 경로가 실제로 쓸 수 있는 곳인지는 에이전트가 다시 검사한다.
 */
export class LocalLinksService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async registerDevice(userId: string, name: string): Promise<DeviceView> {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > MAX_DEVICE_NAME) throw new InvalidDeviceNameError();
    const row = await this.prisma.agentDevice.create({
      data: { userId, name: trimmed, createdAt: this.now() },
    });
    return toDeviceView(row);
  }

  async listDevices(userId: string): Promise<DeviceView[]> {
    const rows = await this.prisma.agentDevice.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDeviceView);
  }

  async removeDevice(userId: string, deviceId: string): Promise<void> {
    const { count } = await this.prisma.agentDevice.deleteMany({ where: { id: deviceId, userId } });
    if (count === 0) throw new DeviceNotFoundError(deviceId);
  }

  async list(userId: string): Promise<LocalLinkView[]> {
    return this.views(
      await this.prisma.localLink.findMany({
        where: { device: { userId } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: LINK_INCLUDE,
      }),
    );
  }

  /** 대시보드에서 만들면 승인 대기, PC에서 만들면(approved) 바로 활성이다 (결정 61) */
  async create(
    userId: string,
    input: LocalLinkInput,
    options: { approved?: boolean } = {},
  ): Promise<LocalLinkView> {
    await this.ownedDevice(userId, input.deviceId);
    if (input.project === SHARED_PROJECT_NAME) throw new SharedGroupNotLinkableError();
    const project = await this.prisma.project.findUnique({ where: { name: input.project } });
    if (!project) throw new ProjectNotFoundError(input.project);
    if (!isValidLocalPath(input.path)) throw new InvalidLocalPathError();

    const now = this.now();
    try {
      const row = await this.prisma.localLink.create({
        data: {
          deviceId: input.deviceId,
          projectId: project.id,
          path: input.path,
          status: options.approved ? 'active' : 'pending',
          approvedAt: options.approved ? now : null,
          createdAt: now,
          updatedAt: now,
        },
        include: LINK_INCLUDE,
      });
      return (await this.views([row]))[0] as LocalLinkView;
    } catch (error) {
      if (isUniqueViolation(error)) throw new LocalLinkExistsError(input.path);
      throw error;
    }
  }

  /** 경로를 바꾸면 다른 파일이므로 승인과 기록을 처음부터 다시 한다 */
  async update(
    userId: string,
    id: string,
    input: { path?: string; paused?: boolean },
  ): Promise<LocalLinkView> {
    const current = await this.ownedLink(userId, id);
    const moved = input.path !== undefined && input.path !== current.path;
    if (moved && !isValidLocalPath(input.path as string)) throw new InvalidLocalPathError();
    const approvedAt = moved ? null : current.approvedAt;
    const paused = input.paused ?? current.status === 'paused';
    const status: LocalLinkStatus = paused ? 'paused' : approvedAt ? 'active' : 'pending';

    try {
      const row = await this.prisma.localLink.update({
        where: { id },
        data: {
          status,
          ...(moved
            ? {
                path: input.path,
                approvedAt: null,
                lastWrittenVersion: null,
                lastWrittenSharedVersion: null,
                lastWrittenAt: null,
                lastState: null,
                lastMessage: null,
                lastStateAt: null,
                overwriteRequestedAt: null,
              }
            : {}),
          updatedAt: this.now(),
        },
        include: LINK_INCLUDE,
      });
      return (await this.views([row]))[0] as LocalLinkView;
    } catch (error) {
      if (isUniqueViolation(error)) throw new LocalLinkExistsError(input.path as string);
      throw error;
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.localLink.deleteMany({
      where: { id, device: { userId } },
    });
    if (count === 0) throw new LocalLinkNotFoundError(id);
  }

  /** 로컬에서 고친 파일도 다음 주기에 덮어쓰게 한다 (결정 62) */
  async requestOverwrite(userId: string, id: string): Promise<LocalLinkView> {
    await this.ownedLink(userId, id);
    return this.updateLink(id, { overwriteRequestedAt: this.now() });
  }

  /** 에이전트가 자기 기기의 연결을 조회한다. 조회 시각이 "실행 중" 표시의 기준이다 */
  async forDevice(userId: string, deviceId: string): Promise<LocalLinkView[]> {
    await this.ownedDevice(userId, deviceId);
    await this.prisma.agentDevice.update({
      where: { id: deviceId },
      data: { lastSeenAt: this.now() },
    });
    return this.views(
      await this.prisma.localLink.findMany({
        where: { deviceId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: LINK_INCLUDE,
      }),
    );
  }

  /** PC에서 승인한다. 컨트롤러는 CLI 토큰으로 온 요청만 여기로 보낸다 (결정 61) */
  async approve(userId: string, id: string): Promise<LocalLinkView> {
    const current = await this.ownedLink(userId, id);
    if (current.status !== 'pending') return (await this.views([current]))[0] as LocalLinkView;
    const now = this.now();
    return this.updateLink(id, { status: 'active', approvedAt: now });
  }

  async report(userId: string, id: string, input: LocalLinkReport): Promise<LocalLinkView> {
    const current = await this.ownedLink(userId, id);
    if (current.status !== 'active') throw new LocalLinkNotActiveError(id);
    const now = this.now();
    const message = input.message?.trim().slice(0, MAX_MESSAGE) || null;
    return this.updateLink(id, {
      lastState: input.state,
      lastMessage: message,
      lastStateAt: now,
      ...(input.written
        ? {
            lastWrittenVersion: input.written.version,
            lastWrittenSharedVersion: input.written.sharedVersion,
            lastWrittenAt: now,
            overwriteRequestedAt: null,
          }
        : {}),
    });
  }

  private async ownedDevice(userId: string, deviceId: string) {
    const device = await this.prisma.agentDevice.findFirst({ where: { id: deviceId, userId } });
    if (!device) throw new DeviceNotFoundError(deviceId);
    return device;
  }

  private async ownedLink(userId: string, id: string): Promise<LinkRow> {
    const row = await this.prisma.localLink.findFirst({
      where: { id, device: { userId } },
      include: LINK_INCLUDE,
    });
    if (!row) throw new LocalLinkNotFoundError(id);
    return row;
  }

  private async updateLink(
    id: string,
    data: Parameters<PrismaClient['localLink']['update']>[0]['data'],
  ): Promise<LocalLinkView> {
    const row = await this.prisma.localLink.update({
      where: { id },
      data: { ...data, updatedAt: this.now() },
      include: LINK_INCLUDE,
    });
    return (await this.views([row]))[0] as LocalLinkView;
  }

  /** 연결마다 프로젝트의 현재 local 버전과 공유 그룹의 현재 local 버전을 붙인다 */
  private async views(rows: LinkRow[]): Promise<LocalLinkView[]> {
    if (rows.length === 0) return [];
    const projects = [...new Set(rows.map((row) => row.project.name)), SHARED_PROJECT_NAME];
    const environments = await this.prisma.environment.findMany({
      where: { name: 'local', project: { name: { in: projects } } },
      select: { currentVersion: true, project: { select: { name: true } } },
    });
    const versions = new Map(environments.map((env) => [env.project.name, env.currentVersion]));
    const sharedVersion = versions.get(SHARED_PROJECT_NAME) ?? 0;
    return rows.map((row) => toLinkView(row, versions.get(row.project.name) ?? 0, sharedVersion));
  }
}

function toDeviceView(row: {
  id: string;
  name: string;
  createdAt: Date;
  lastSeenAt: Date | null;
}): DeviceView {
  return { id: row.id, name: row.name, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt };
}

function toLinkView(row: LinkRow, version: number, sharedVersion: number): LocalLinkView {
  return {
    id: row.id,
    device: { id: row.device.id, name: row.device.name },
    project: row.project.name,
    path: row.path,
    status: row.status,
    approvedAt: row.approvedAt,
    current: { version, sharedVersion },
    lastWritten:
      row.lastWrittenVersion !== null && row.lastWrittenAt
        ? {
            version: row.lastWrittenVersion,
            sharedVersion: row.lastWrittenSharedVersion ?? 0,
            at: row.lastWrittenAt,
          }
        : null,
    lastState:
      row.lastState && row.lastStateAt
        ? { state: row.lastState, message: row.lastMessage, at: row.lastStateAt }
        : null,
    overwriteRequested: row.overwriteRequestedAt !== null,
    createdAt: row.createdAt,
  };
}
