// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 쓴다
import { PlusIcon, RepoIcon, StackIcon } from '@primer/octicons-react';
import {
  Button,
  Dialog,
  Flash,
  FormControl,
  Label,
  PageHeader,
  Spinner,
  Stack,
  TextInput,
} from '@primer/react';
import { type ApiSchemas, SenvApiError, unwrap } from '@senv/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApi } from '../api-context';
import { useMe } from '../auth/use-me';
import { PROJECTS_QUERY_KEY, useProjects } from '../project/queries';
import list from '../ui/list-box.module.css';

type Project = ApiSchemas['ProjectListItem'];

export function ProjectsPage() {
  const me = useMe();
  const [creating, setCreating] = useState(false);
  const projects = useProjects();

  return (
    <Stack gap="normal">
      <PageHeader>
        <PageHeader.TitleArea>
          <PageHeader.Title as="h2">프로젝트</PageHeader.Title>
        </PageHeader.TitleArea>
        {me.data?.role === 'admin' && (
          <PageHeader.Actions>
            <Button variant="primary" leadingVisual={PlusIcon} onClick={() => setCreating(true)}>
              새 프로젝트
            </Button>
          </PageHeader.Actions>
        )}
      </PageHeader>
      {projects.isPending && <Spinner />}
      {projects.isError && <Flash variant="danger">프로젝트를 불러오지 못했습니다.</Flash>}
      {projects.data && <ProjectList projects={projects.data.projects} />}
      {creating && (
        <Dialog title="새 프로젝트" width="medium" onClose={() => setCreating(false)}>
          <CreateProjectForm onDone={() => setCreating(false)} />
        </Dialog>
      )}
    </Stack>
  );
}

/** 공유 그룹을 맨 위에 두고, 그 아래에 앱 프로젝트를 이름 순으로 보여준다 */
function ProjectList({ projects }: { projects: Project[] }) {
  return (
    <ul className={list.box}>
      <li className={list.row}>
        <StackIcon className={list.icon} />
        <Link className={list.title} to="/projects/$project" params={{ project: 'shared' }}>
          공유 그룹
        </Link>
        <Label>shared</Label>
        <span className={list.description}>
          여러 프로젝트가 같이 쓰는 값. 다른 프로젝트에서 {'${shared.KEY}'}로 참조합니다.
        </span>
      </li>
      {projects.map((project) => (
        <li key={project.name} className={list.row}>
          <RepoIcon className={list.icon} />
          <Link className={list.title} to="/projects/$project" params={{ project: project.name }}>
            {project.name}
          </Link>
          <span className={list.description}>{project.displayName}</span>
          {project.summary && <ProjectSummaryLine summary={project.summary} />}
        </li>
      ))}
      {projects.length === 0 && <li className={list.empty}>아직 프로젝트가 없습니다.</li>}
    </ul>
  );
}

/** 관리자만 연다 (M1에서 구조 변경은 관리자 몫) */
function CreateProjectForm({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/projects', {
          body: { name, ...(displayName ? { displayName } : {}) },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
      onDone();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <form aria-label="새 프로젝트" onSubmit={submit}>
      <Stack>
        {create.isError && (
          <Flash variant="danger">
            {create.error instanceof SenvApiError ? create.error.message : '만들지 못했습니다.'}
          </Flash>
        )}
        <FormControl>
          <FormControl.Label>이름</FormControl.Label>
          <FormControl.Caption>소문자·숫자·하이픈, 32자 이하 (예: web-admin)</FormControl.Caption>
          <TextInput block value={name} onChange={(event) => setName(event.target.value)} />
        </FormControl>
        <FormControl>
          <FormControl.Label>표시 이름</FormControl.Label>
          <TextInput
            block
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </FormControl>
        <Stack direction="horizontal" justify="end" gap="condensed">
          <Button onClick={onDone}>취소</Button>
          <Button type="submit" variant="primary" disabled={!name || create.isPending}>
            프로젝트 만들기
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}

/** 환경별 현재 버전과 누락 칸 수 (PRD 7.1) */
function ProjectSummaryLine({ summary }: { summary: NonNullable<Project['summary']> }) {
  return (
    <span className={list.meta}>
      {summary.environments.map(({ env, version }) => (
        <Label key={env} variant={version === 0 ? 'secondary' : 'default'}>
          {version === 0 ? `${env} 게시 전` : `${env} v${version}`}
        </Label>
      ))}
      {summary.missing > 0 && <Label variant="attention">누락 {summary.missing}</Label>}
      {summary.missingRequired > 0 && (
        <Label variant="danger">필수 {summary.missingRequired}</Label>
      )}
    </span>
  );
}
