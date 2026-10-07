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

/** 버전 기록. environmentKey의 아래에 두어 게시하면 함께 새로 받는다 */
export const versionsKey = (project: string, env: string) =>
  ['project', project, 'env', env, 'versions'] as const;
export const versionKey = (project: string, env: string, version: number) =>
  ['project', project, 'env', env, 'versions', version] as const;

export type VersionInfo = ApiSchemas['VersionInfo'];
export type KeySchema = ApiSchemas['KeySchema'];

export const schemaKey = (project: string) => ['project', project, 'schema'] as const;

/** 키 스키마와 공개 접두사 (PRD 5.2, 6.3) */
export function useKeySchema(project: string) {
  const api = useApi();
  return useQuery({
    queryKey: schemaKey(project),
    queryFn: () =>
      unwrap(api.GET('/api/v1/projects/{project}/schema', { params: { path: { project } } })),
  });
}

export function useVersions(project: string, env: string) {
  const api = useApi();
  return useQuery({
    queryKey: versionsKey(project, env),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/projects/{project}/envs/{env}/versions', {
          params: { path: { project, env } },
        }),
      ),
  });
}

/** 지난 버전의 값. 버전 0은 게시 전이라 빈 값이다. 지난 버전은 바뀌지 않으므로 계속 캐시한다 */
export function useVersionValues(project: string, env: string, version: number) {
  const api = useApi();
  return useQuery({
    queryKey: versionKey(project, env, version),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async (): Promise<EnvironmentValues> =>
      version === 0
        ? { project, env, version: 0, variables: {} }
        : unwrap(
            api.GET('/api/v1/projects/{project}/envs/{env}/versions/{version}', {
              params: { path: { project, env, version: String(version) } },
            }),
          ),
  });
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
