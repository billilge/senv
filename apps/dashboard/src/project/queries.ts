import { type ApiSchemas, type SenvClient, unwrap } from '@senv/api-client';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useApi } from '../api-context';

export type Project = ApiSchemas['Project'];
export type EnvironmentValues = ApiSchemas['EnvironmentValues'];
export type EnvironmentName = Project['environments'][number];

export const PROJECTS_QUERY_KEY = ['projects'] as const;
export const projectKey = (project: string) => ['project', project] as const;
export const environmentKey = (project: string, env: string) =>
  ['project', project, 'env', env] as const;

/** 앱 프로젝트 목록 (공유 그룹 제외). 프로젝트 목록 화면과 헤더의 개수 배지가 같이 쓴다 */
export function useProjects() {
  const api = useApi();
  return useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: () => unwrap(api.GET('/api/v1/projects')),
  });
}

export function useProject(project: string) {
  const api = useApi();
  return useQuery({
    queryKey: projectKey(project),
    queryFn: () => unwrap(api.GET('/api/v1/projects/{project}', { params: { path: { project } } })),
  });
}

/** 편집용 원래 값 (공유 참조를 해석하기 전) */
export function fetchEnvironmentValues(api: SenvClient, project: string, env: string) {
  return unwrap(
    api.GET('/api/v1/projects/{project}/envs/{env}', { params: { path: { project, env } } }),
  );
}

export function useEnvironmentValues(project: string, envs: readonly EnvironmentName[]) {
  const api = useApi();
  return useQueries({
    queries: envs.map((env) => ({
      queryKey: environmentKey(project, env),
      queryFn: () => fetchEnvironmentValues(api, project, env),
    })),
  });
}
