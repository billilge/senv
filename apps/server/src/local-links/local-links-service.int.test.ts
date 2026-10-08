import { SHARED_PROJECT_NAME } from '@senv/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ProjectNotFoundError, ProjectsService } from '../projects/projects-service.js';
import { createTestPrisma, resetDatabase } from '../testing/database.js';
import { createTestUser } from '../testing/users.js';
import {
  DeviceNotFoundError,
  InvalidDeviceNameError,
  InvalidLocalPathError,
  LocalLinkExistsError,
  LocalLinkNotActiveError,
  LocalLinkNotFoundError,
  LocalLinksService,
  SharedGroupNotLinkableError,
} from './local-links-service.js';

const prisma = createTestPrisma();
let now = new Date('2026-10-09T09:00:00.000Z');
const service = new LocalLinksService(prisma, () => now);

let alice: string;
let bob: string;
let laptop: string;

async function setVersion(project: string, version: number) {
  await prisma.environment.updateMany({
    where: { name: 'local', project: { name: project } },
    data: { currentVersion: version },
  });
}

beforeEach(async () => {
  await resetDatabase(prisma);
  now = new Date('2026-10-09T09:00:00.000Z');
  const projects = new ProjectsService(prisma);
  await projects.create({ name: 'web' });
  await projects.create({ name: 'api' });
  await projects.ensureSharedProject();
  alice = (await createTestUser(prisma)).id;
  bob = (await createTestUser(prisma)).id;
  laptop = (await service.registerDevice(alice, 'alice-mbp')).id;
});
afterAll(() => prisma.$disconnect());

const link = (overrides: Partial<{ deviceId: string; project: string; path: string }> = {}) =>
  service.create(alice, {
    deviceId: laptop,
    project: 'web',
    path: '/Users/alice/work/web',
    ...overrides,
  });

describe('기기', () => {
  it('등록한 기기는 본인 목록에만 보인다', async () => {
    expect(await service.listDevices(alice)).toEqual([
      { id: laptop, name: 'alice-mbp', createdAt: now, lastSeenAt: null },
    ]);
    expect(await service.listDevices(bob)).toEqual([]);
  });

  it('이름은 앞뒤 공백을 빼고 1~100자여야 한다', async () => {
    expect((await service.registerDevice(alice, '  desk  ')).name).toBe('desk');
    await expect(service.registerDevice(alice, '   ')).rejects.toThrow(InvalidDeviceNameError);
    await expect(service.registerDevice(alice, 'x'.repeat(101))).rejects.toThrow(
      InvalidDeviceNameError,
    );
  });

  it('기기를 지우면 그 연결도 지운다. 다른 사람의 기기는 없는 것으로 본다', async () => {
    await link();
    await expect(service.removeDevice(bob, laptop)).rejects.toThrow(DeviceNotFoundError);
    await service.removeDevice(alice, laptop);
    expect(await service.listDevices(alice)).toEqual([]);
    expect(await service.list(alice)).toEqual([]);
  });
});

describe('연결 만들기', () => {
  it('대시보드에서 만든 연결은 승인 대기다. 현재 local·공유 버전을 함께 보여준다', async () => {
    await setVersion('web', 12);
    await setVersion(SHARED_PROJECT_NAME, 3);

    const created = await link();

    expect(created).toEqual({
      id: expect.any(String),
      device: { id: laptop, name: 'alice-mbp' },
      project: 'web',
      path: '/Users/alice/work/web',
      status: 'pending',
      approvedAt: null,
      current: { version: 12, sharedVersion: 3 },
      lastWritten: null,
      lastState: null,
      overwriteRequested: false,
      createdAt: now,
    });
    expect(await service.list(alice)).toEqual([created]);
    expect(await service.list(bob)).toEqual([]);
  });

  it('PC에서 만든 연결(senv link add)은 바로 활성이다', async () => {
    const created = await link();
    expect(created.status).toBe('pending');
    const fromAgent = await service.create(
      alice,
      { deviceId: laptop, project: 'api', path: '/Users/alice/work/api' },
      { approved: true },
    );
    expect(fromAgent).toMatchObject({ status: 'active', approvedAt: now });
  });

  it('남의 기기, 없는 프로젝트, 공유 그룹, 잘못된 경로, 같은 경로는 거부한다', async () => {
    await expect(
      service.create(bob, { deviceId: laptop, project: 'web', path: '/x' }),
    ).rejects.toThrow(DeviceNotFoundError);
    await expect(link({ project: 'nope' })).rejects.toThrow(ProjectNotFoundError);
    await expect(link({ project: SHARED_PROJECT_NAME })).rejects.toThrow(
      SharedGroupNotLinkableError,
    );
    await expect(link({ path: 'relative/web' })).rejects.toThrow(InvalidLocalPathError);
    await link();
    await expect(link({ project: 'api' })).rejects.toThrow(LocalLinkExistsError);
  });
});

describe('연결 바꾸기', () => {
  it('경로를 바꾸면 다시 승인 대기가 되고 마지막 기록을 지운다', async () => {
    const created = await link();
    await service.approve(alice, created.id);
    await service.report(alice, created.id, {
      state: 'ok',
      written: { version: 1, sharedVersion: 0 },
    });

    const moved = await service.update(alice, created.id, { path: '/Users/alice/new/web' });

    expect(moved).toMatchObject({
      path: '/Users/alice/new/web',
      status: 'pending',
      approvedAt: null,
      lastWritten: null,
      lastState: null,
    });
  });

  it('일시정지하고 다시 켜면 승인했던 연결은 활성, 승인 전이면 승인 대기로 돌아간다', async () => {
    const created = await link();
    expect((await service.update(alice, created.id, { paused: true })).status).toBe('paused');
    expect((await service.update(alice, created.id, { paused: false })).status).toBe('pending');
    await service.approve(alice, created.id);
    await service.update(alice, created.id, { paused: true });
    expect((await service.update(alice, created.id, { paused: false })).status).toBe('active');
  });

  it('덮어쓰기를 요청하고, 지우면 사라진다. 남의 연결은 없는 것으로 본다', async () => {
    const created = await link();
    expect((await service.requestOverwrite(alice, created.id)).overwriteRequested).toBe(true);
    await expect(service.requestOverwrite(bob, created.id)).rejects.toThrow(LocalLinkNotFoundError);
    await expect(service.remove(bob, created.id)).rejects.toThrow(LocalLinkNotFoundError);
    await service.remove(alice, created.id);
    expect(await service.list(alice)).toEqual([]);
  });
});

describe('에이전트', () => {
  it('기기의 연결을 조회하면 마지막 접속 시각을 남긴다', async () => {
    const created = await link();
    await service.create(
      alice,
      { deviceId: (await service.registerDevice(alice, 'desk')).id, project: 'web', path: '/w' },
      { approved: true },
    );
    now = new Date('2026-10-09T09:05:00.000Z');

    const links = await service.forDevice(alice, laptop);

    expect(links.map((l) => l.id)).toEqual([created.id]);
    expect((await service.listDevices(alice)).find((d) => d.id === laptop)?.lastSeenAt).toEqual(
      now,
    );
    await expect(service.forDevice(bob, laptop)).rejects.toThrow(DeviceNotFoundError);
  });

  it('승인하면 활성이 되고, 남의 연결은 승인할 수 없다', async () => {
    const created = await link();
    await expect(service.approve(bob, created.id)).rejects.toThrow(LocalLinkNotFoundError);
    expect(await service.approve(alice, created.id)).toMatchObject({
      status: 'active',
      approvedAt: now,
    });
  });

  it('썼다고 보고하면 버전과 시각을 남기고 덮어쓰기 요청을 지운다', async () => {
    const created = await link();
    await service.approve(alice, created.id);
    await service.requestOverwrite(alice, created.id);

    const reported = await service.report(alice, created.id, {
      state: 'ok',
      written: { version: 12, sharedVersion: 3 },
    });

    expect(reported).toMatchObject({
      lastWritten: { version: 12, sharedVersion: 3, at: now },
      lastState: { state: 'ok', message: null, at: now },
      overwriteRequested: false,
    });
  });

  it('쓰지 못했다는 보고는 상태와 설명만 남기고 마지막으로 쓴 기록은 그대로 둔다', async () => {
    const created = await link();
    await service.approve(alice, created.id);
    await service.report(alice, created.id, {
      state: 'ok',
      written: { version: 1, sharedVersion: 0 },
    });
    await service.requestOverwrite(alice, created.id);

    const reported = await service.report(alice, created.id, {
      state: 'modified',
      message: '  마지막으로 쓴 뒤 파일이 바뀌었습니다  ',
    });

    expect(reported).toMatchObject({
      lastWritten: { version: 1, sharedVersion: 0 },
      lastState: { state: 'modified', message: '마지막으로 쓴 뒤 파일이 바뀌었습니다' },
      overwriteRequested: true,
    });
  });

  it('활성이 아닌 연결의 보고는 받지 않는다', async () => {
    const created = await link();
    await expect(service.report(alice, created.id, { state: 'ok' })).rejects.toThrow(
      LocalLinkNotActiveError,
    );
  });
});
