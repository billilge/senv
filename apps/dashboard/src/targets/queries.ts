import { type ApiSchemas, unwrap } from '@senv/api-client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api-context';

export type TargetProvider = ApiSchemas['TargetProvider'];
export type TargetConnection = ApiSchemas['TargetConnection'];
export type TargetMapping = ApiSchemas['TargetMapping'];
export type SyncPreview = ApiSchemas['SyncPreview'];
export type SyncRun = ApiSchemas['SyncRun'];

export const PROVIDERS_KEY = ['targets', 'providers'] as const;
export const CONNECTIONS_KEY = ['targets', 'connections'] as const;
export const mappingsKey = (project: string) => ['project', project, 'targets'] as const;

export function useProviders() {
  const api = useApi();
  return useQuery({
    queryKey: PROVIDERS_KEY,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => unwrap(api.GET('/api/v1/targets/providers')),
  });
}

/** 연결 목록 (관리자만) */
export function useConnections(options: { enabled?: boolean } = {}) {
  const api = useApi();
  return useQuery({
    queryKey: CONNECTIONS_KEY,
    enabled: options.enabled ?? true,
    queryFn: () => unwrap(api.GET('/api/v1/targets/connections')),
  });
}

export function useResources(connectionId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['targets', 'connections', connectionId, 'resources'],
    enabled: connectionId !== '',
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/targets/connections/{id}/resources', {
          params: { path: { id: connectionId } },
        }),
      ),
  });
}

export function useMappings(project: string) {
  const api = useApi();
  return useQuery({
    queryKey: mappingsKey(project),
    queryFn: () =>
      unwrap(api.GET('/api/v1/projects/{project}/targets', { params: { path: { project } } })),
  });
}

/** 제공자 표시 이름. 목록을 못 받았으면 종류 이름의 첫 글자만 대문자로 */
export function providerName(providers: TargetProvider[] | undefined, type: string): string {
  return (
    providers?.find((provider) => provider.type === type)?.displayName ??
    `${type.charAt(0).toUpperCase()}${type.slice(1)}`
  );
}

export const ACTION_TEXT: Record<'restart' | 'redeploy', string> = {
  restart: '재시작',
  redeploy: '재배포',
};
