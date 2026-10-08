import type { LocalLinkState } from '@senv/core';

/**
 * 목업의 로컬 자동 받기 (M1.1). 에이전트가 없으므로 "실행 중"인 PC 하나와,
 * 반영된 연결·승인 대기 연결을 미리 둔다. 대시보드에서 추가한 연결은 승인 대기로 남는다.
 */

export interface MockDevice {
  id: string;
  name: string;
  createdAt: string;
  /** 에이전트가 도는 것처럼 보이게 한다 (조회할 때마다 방금 확인한 시각) */
  running: boolean;
}

export interface MockLocalLink {
  id: string;
  deviceId: string;
  project: string;
  path: string;
  status: 'pending' | 'active' | 'paused';
  approvedAt: string | null;
  lastWritten: { version: number; sharedVersion: number; at: string } | null;
  lastState: { state: LocalLinkState; message: string | null; at: string } | null;
  overwriteRequested: boolean;
  createdAt: string;
}

export interface MockLocalState {
  devices: MockDevice[];
  links: MockLocalLink[];
}

const AT = '2026-10-01T09:00:00.000Z';

export function initialLocal(): MockLocalState {
  return {
    devices: [
      { id: 'dev-mbp', name: 'my-macbook', createdAt: AT, running: true },
      { id: 'dev-desk', name: 'office-desktop', createdAt: AT, running: false },
    ],
    links: [
      {
        id: 'll-web',
        deviceId: 'dev-mbp',
        project: 'web',
        path: '/Users/me/work/stream-web',
        status: 'active',
        approvedAt: AT,
        lastWritten: { version: 2, sharedVersion: 1, at: AT },
        lastState: { state: 'ok', message: null, at: AT },
        overwriteRequested: false,
        createdAt: AT,
      },
      {
        id: 'll-server',
        deviceId: 'dev-mbp',
        project: 'server',
        path: '/Users/me/work/stream-api',
        status: 'active',
        approvedAt: AT,
        lastWritten: { version: 1, sharedVersion: 1, at: AT },
        lastState: {
          state: 'modified',
          message:
            '.env.local을(를) 직접 고친 것 같아 덮어쓰지 않았습니다. 대시보드에서 덮어쓰기를 누르면 씁니다',
          at: AT,
        },
        overwriteRequested: false,
        createdAt: AT,
      },
      {
        id: 'll-app',
        deviceId: 'dev-desk',
        project: 'app',
        path: 'C:\\work\\stream-app',
        status: 'pending',
        approvedAt: null,
        lastWritten: null,
        lastState: null,
        overwriteRequested: false,
        createdAt: AT,
      },
    ],
  };
}

export function deviceView(device: MockDevice) {
  return {
    id: device.id,
    name: device.name,
    createdAt: device.createdAt,
    lastSeenAt: device.running ? new Date(Date.now() - 5_000).toISOString() : AT,
  };
}

export function localLinkView(
  link: MockLocalLink,
  local: MockLocalState,
  current: { version: number; sharedVersion: number },
) {
  const device = local.devices.find((candidate) => candidate.id === link.deviceId);
  return {
    id: link.id,
    device: { id: link.deviceId, name: device?.name ?? '' },
    project: link.project,
    path: link.path,
    status: link.status,
    approvedAt: link.approvedAt,
    current,
    lastWritten: link.lastWritten,
    lastState: link.lastState,
    overwriteRequested: link.overwriteRequested,
    createdAt: link.createdAt,
  };
}
