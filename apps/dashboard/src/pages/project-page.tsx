import { Flash, Heading, Spinner, Stack, Text } from '@primer/react';
import { SenvApiError } from '@senv/api-client';
import { Matrix } from '../project/matrix';
import {
  type EnvironmentName,
  type EnvironmentValues,
  useEnvironmentValues,
  useProject,
} from '../project/queries';

export function ProjectPage({ project }: { project: string }) {
  const info = useProject(project);

  if (info.isPending) return <Spinner />;
  if (info.isError) {
    return (
      <Flash variant="danger">
        {info.error instanceof SenvApiError
          ? info.error.message
          : '프로젝트를 불러오지 못했습니다.'}
      </Flash>
    );
  }
  return (
    <ProjectValues
      project={project}
      displayName={info.data.displayName}
      kind={info.data.kind}
      envs={info.data.environments}
    />
  );
}

function ProjectValues({
  project,
  displayName,
  kind,
  envs,
}: {
  project: string;
  displayName: string;
  kind: 'app' | 'shared';
  envs: EnvironmentName[];
}) {
  const results = useEnvironmentValues(project, envs);
  if (results.some((result) => result.isPending)) return <Spinner />;
  if (results.some((result) => result.isError)) {
    return <Flash variant="danger">값을 불러오지 못했습니다.</Flash>;
  }

  const values: Partial<Record<EnvironmentName, EnvironmentValues>> = {};
  envs.forEach((env, index) => {
    const data = results[index]?.data;
    if (data) values[env] = data;
  });
  const keys = new Set(envs.flatMap((env) => Object.keys(values[env]?.variables ?? {})));
  const exampleKey = [...keys].sort()[0] ?? 'KEY';

  return (
    <Stack>
      <Heading as="h2">
        {project} <Text>{displayName}</Text>
      </Heading>
      {kind === 'shared' && (
        <Flash>
          여러 프로젝트가 같이 쓰는 값입니다. 다른 프로젝트에서는 {'${shared.'}
          {exampleKey}
          {'}'}처럼 참조합니다.
        </Flash>
      )}
      {keys.size === 0 ? <Text>아직 값이 없습니다.</Text> : <Matrix envs={envs} values={values} />}
    </Stack>
  );
}
