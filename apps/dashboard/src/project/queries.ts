import { type ApiSchemas, unwrap } from '@senv/api-client';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useApi } from '../api-context';

export type Project = ApiSchemas['Project'];
export type EnvironmentValues = ApiSchemas['EnvironmentValues'];
export type EnvironmentName = Project['environments'][number];

export const projectKey = (project: string) => ['project', project] as const;
export const environmentKey = (project: string, env: string) =>
  ['project', project, 'env', env] as const;

export function useProject(project: string) {
  const api = useApi();
  return useQuery({
    queryKey: projectKey(project),
    queryFn: () => unwrap(api.GET('/api/v1/projects/{project}', { params: { path: { project } } })),
  });
}

/** 편집용 원래 값 (공유 참조를 해석하기 전) */
export function useEnvironmentValues(project: string, envs: readonly EnvironmentName[]) {
  const api = useApi();
  return useQueries({
    queries: envs.map((env) => ({
      queryKey: environmentKey(project, env),
      queryFn: () =>
        unwrap(
          api.GET('/api/v1/projects/{project}/envs/{env}', { params: { path: { project, env } } }),
        ),
    })),
  });
}
