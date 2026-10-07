import { PencilIcon, RepoIcon, StackIcon } from '@primer/octicons-react';
import { Button, Flash, PageHeader, Spinner, Stack } from '@primer/react';
import { SenvApiError } from '@senv/api-client';
import { useState } from 'react';
import { EnvironmentEditor } from '../project/environment-editor';
import { Matrix } from '../project/matrix';
import {
  type EnvironmentName,
  type EnvironmentValues,
  useEnvironmentValues,
  useProject,
} from '../project/queries';
import list from '../ui/list-box.module.css';

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
  const [editing, setEditing] = useState<EnvironmentName | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  const editingValues = editing && values[editing];

  return (
    <Stack gap="normal">
      <PageHeader>
        <PageHeader.TitleArea>
          <PageHeader.LeadingVisual>
            {kind === 'shared' ? <StackIcon /> : <RepoIcon />}
          </PageHeader.LeadingVisual>
          <PageHeader.Title as="h2">{project}</PageHeader.Title>
        </PageHeader.TitleArea>
        <PageHeader.Description>{displayName}</PageHeader.Description>
        {!editing && (
          <PageHeader.Actions>
            {envs.map((env) => (
              <Button
                key={env}
                leadingVisual={PencilIcon}
                onClick={() => {
                  setNotice(null);
                  setEditing(env);
                }}
              >
                {env} 편집
              </Button>
            ))}
          </PageHeader.Actions>
        )}
      </PageHeader>
      {kind === 'shared' && (
        <Flash>
          여러 프로젝트가 같이 쓰는 값입니다. 다른 프로젝트에서는 {'${shared.'}
          {exampleKey}
          {'}'}처럼 참조합니다.
        </Flash>
      )}
      {notice && <Flash variant="success">{notice}</Flash>}
      {editing && editingValues ? (
        <EnvironmentEditor
          key={editing}
          project={project}
          values={editingValues}
          onCancel={() => setEditing(null)}
          onPublished={(version) => {
            setEditing(null);
            setNotice(`게시했습니다: ${editing} v${version}`);
          }}
        />
      ) : keys.size === 0 ? (
        <div className={list.box}>
          <p className={list.empty}>아직 값이 없습니다. 위의 편집 버튼으로 값을 추가하세요.</p>
        </div>
      ) : (
        <Matrix envs={envs} values={values} />
      )}
    </Stack>
  );
}
