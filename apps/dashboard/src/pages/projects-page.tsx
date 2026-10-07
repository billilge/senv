import {
  Button,
  Flash,
  FormControl,
  Heading,
  Spinner,
  Stack,
  Text,
  TextInput,
} from '@primer/react';
import { type ApiSchemas, SenvApiError, unwrap } from '@senv/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApi } from '../api-context';
import { useMe } from '../auth/use-me';

type Project = ApiSchemas['Project'];

const PROJECTS_QUERY_KEY = ['projects'] as const;

export function ProjectsPage() {
  const api = useApi();
  const me = useMe();
  const projects = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: () => unwrap(api.GET('/api/v1/projects')),
  });

  return (
    <Stack>
      <Heading as="h2">프로젝트</Heading>
      {projects.isPending && <Spinner />}
      {projects.isError && <Flash variant="danger">프로젝트를 불러오지 못했습니다.</Flash>}
      {projects.data && <ProjectList projects={projects.data.projects} />}
      <Link to="/projects/$project" params={{ project: 'shared' }}>
        공유 그룹 (여러 프로젝트가 같이 쓰는 값)
      </Link>
      {me.data?.role === 'admin' && <CreateProjectForm />}
    </Stack>
  );
}

function ProjectList({ projects }: { projects: Project[] }) {
  if (projects.length === 0) return <Text>아직 프로젝트가 없습니다.</Text>;
  return (
    <ul>
      {projects.map((project) => (
        <li key={project.name}>
          <Stack direction="horizontal" align="center">
            <Link to="/projects/$project" params={{ project: project.name }}>
              {project.name}
            </Link>
            <Text>{project.displayName}</Text>
          </Stack>
        </li>
      ))}
    </ul>
  );
}

/** 관리자만 보인다 (M1에서 구조 변경은 관리자 몫) */
function CreateProjectForm() {
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
      setName('');
      setDisplayName('');
      await queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <form aria-label="새 프로젝트" onSubmit={submit}>
      <Stack>
        <Heading as="h3">새 프로젝트</Heading>
        {create.isError && (
          <Flash variant="danger">
            {create.error instanceof SenvApiError ? create.error.message : '만들지 못했습니다.'}
          </Flash>
        )}
        <FormControl>
          <FormControl.Label>이름</FormControl.Label>
          <FormControl.Caption>소문자·숫자·하이픈, 32자 이하 (예: web-admin)</FormControl.Caption>
          <TextInput value={name} onChange={(event) => setName(event.target.value)} />
        </FormControl>
        <FormControl>
          <FormControl.Label>표시 이름</FormControl.Label>
          <TextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </FormControl>
        <Button type="submit" variant="primary" disabled={!name || create.isPending}>
          프로젝트 만들기
        </Button>
      </Stack>
    </form>
  );
}
