import {
  ChecklistIcon,
  CopyIcon,
  HistoryIcon,
  PencilIcon,
  RepoIcon,
  RocketIcon,
  StackIcon,
  TableIcon,
} from '@primer/octicons-react';
import { Button, Flash, PageHeader, Spinner, Stack, UnderlineNav } from '@primer/react';
import { SenvApiError } from '@senv/api-client';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { matrixNote } from '../local/link-status';
import { useLocalLinks } from '../local/queries';
import { CopyDialog } from '../project/copy-dialog';
import { EnvironmentEditor } from '../project/environment-editor';
import { KeySchemaPanel } from '../project/key-schema';
import { Matrix } from '../project/matrix';
import { ProjectTargets } from '../project/project-targets';
import {
  type EnvironmentName,
  type EnvironmentValues,
  useEnvironmentValues,
  useKeySchema,
  useProject,
} from '../project/queries';
import { VersionHistory } from '../project/version-history';
import list from '../ui/list-box.module.css';

export type ProjectTab = 'values' | 'history' | 'schema' | 'targets';

export function ProjectPage({
  project,
  tab = 'values',
  env,
}: {
  project: string;
  tab?: ProjectTab;
  /** 버전 기록 탭에서 보는 환경 (기본 local) */
  env?: EnvironmentName;
}) {
  const info = useProject(project);
  const navigate = useNavigate();

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
  const { displayName, kind, environments: envs } = info.data;

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
      </PageHeader>
      <UnderlineNav aria-label="프로젝트 메뉴">
        <UnderlineNav.Item
          as={Link}
          to={`/projects/${project}`}
          icon={TableIcon}
          aria-current={tab === 'values' ? 'page' : undefined}
        >
          값
        </UnderlineNav.Item>
        <UnderlineNav.Item
          as={Link}
          to={`/projects/${project}/history`}
          icon={HistoryIcon}
          aria-current={tab === 'history' ? 'page' : undefined}
        >
          버전 기록
        </UnderlineNav.Item>
        <UnderlineNav.Item
          as={Link}
          to={`/projects/${project}/schema`}
          icon={ChecklistIcon}
          aria-current={tab === 'schema' ? 'page' : undefined}
        >
          키 스키마
        </UnderlineNav.Item>
        {kind === 'app' && (
          <UnderlineNav.Item
            as={Link}
            to={`/projects/${project}/targets`}
            icon={RocketIcon}
            aria-current={tab === 'targets' ? 'page' : undefined}
          >
            배포
          </UnderlineNav.Item>
        )}
      </UnderlineNav>
      {tab === 'values' ? (
        <ProjectValues project={project} kind={kind} envs={envs} />
      ) : tab === 'schema' ? (
        <KeySchemaPanel project={project} envs={envs} />
      ) : tab === 'targets' ? (
        <ProjectTargets project={project} envs={envs} />
      ) : (
        <VersionHistory
          project={project}
          envs={envs}
          env={env ?? 'local'}
          onEnvChange={(next) =>
            navigate({
              to: '/projects/$project/history',
              params: { project },
              search: { env: next },
            })
          }
        />
      )}
    </Stack>
  );
}

function ProjectValues({
  project,
  kind,
  envs,
}: {
  project: string;
  kind: 'app' | 'shared';
  envs: EnvironmentName[];
}) {
  const results = useEnvironmentValues(project, envs);
  // 스키마를 못 받아도 값은 보여준다 (모든 값을 가린다)
  const schema = useKeySchema(project);
  // 내 로컬 연결을 못 받아도 값은 보여준다
  const myLink = useLocalLinks().data?.links.find((link) => link.project === project);
  const [editing, setEditing] = useState<{
    env: EnvironmentName;
    initialChanges?: Record<string, string>;
  } | null>(null);
  const [copying, setCopying] = useState(false);
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
  const editingValues = editing && values[editing.env];

  return (
    <Stack gap="normal">
      {kind === 'shared' && (
        <Flash>
          여러 프로젝트가 같이 쓰는 값입니다. 다른 프로젝트에서는 {'${shared.'}
          {exampleKey}
          {'}'}처럼 참조합니다.
        </Flash>
      )}
      {notice && <Flash variant="success">{notice}</Flash>}
      {!editing && (
        <Stack direction="horizontal" gap="condensed" justify="end" wrap="wrap">
          <Button leadingVisual={CopyIcon} onClick={() => setCopying(true)}>
            환경 간 복사
          </Button>
          {envs.map((env) => (
            <Button
              key={env}
              leadingVisual={PencilIcon}
              onClick={() => {
                setNotice(null);
                setEditing({ env });
              }}
            >
              {env} 편집
            </Button>
          ))}
        </Stack>
      )}
      {copying && (
        <CopyDialog
          envs={envs}
          values={values}
          onClose={() => setCopying(false)}
          onApply={(target, changes) => {
            setCopying(false);
            setNotice(null);
            setEditing({ env: target, initialChanges: changes });
          }}
        />
      )}
      {editing && editingValues ? (
        <EnvironmentEditor
          key={editing.env}
          project={project}
          values={editingValues}
          initialChanges={editing.initialChanges}
          onCancel={() => setEditing(null)}
          onPublished={(version) => {
            setEditing(null);
            setNotice(`게시했습니다: ${editing.env} v${version}`);
          }}
        />
      ) : keys.size === 0 ? (
        <div className={list.box}>
          <p className={list.empty}>아직 값이 없습니다. 위의 편집 버튼으로 값을 추가하세요.</p>
        </div>
      ) : (
        <Matrix
          envs={envs}
          values={values}
          schema={schema.data?.keys}
          localNote={myLink ? matrixNote(myLink) : undefined}
        />
      )}
    </Stack>
  );
}
