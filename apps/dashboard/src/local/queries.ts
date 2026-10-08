import { type ApiSchemas, unwrap } from '@senv/api-client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api-context';

export type AgentDevice = ApiSchemas['AgentDevice'];
export type LocalLink = ApiSchemas['LocalLink'];

export const DEVICES_KEY = ['me', 'devices'] as const;
export const LOCAL_LINKS_KEY = ['me', 'local-links'] as const;

/** 에이전트가 이 시간 안에 조회했으면 "실행 중"으로 본다 (기본 주기 30초의 세 배) */
export const RUNNING_WITHIN_MS = 90_000;

export function useDevices() {
  const api = useApi();
  return useQuery({
    queryKey: DEVICES_KEY,
    queryFn: () => unwrap(api.GET('/api/v1/me/devices')),
  });
}

export function useLocalLinks() {
  const api = useApi();
  return useQuery({
    queryKey: LOCAL_LINKS_KEY,
    queryFn: () => unwrap(api.GET('/api/v1/me/local-links')),
  });
}

export function isRunning(device: AgentDevice, now = Date.now()): boolean {
  return device.lastSeenAt !== null && now - Date.parse(device.lastSeenAt) < RUNNING_WITHIN_MS;
}
