import { SyncIcon } from '@primer/octicons-react';
import {
  Button,
  Dialog,
  Flash,
  FormControl,
  Label,
  Link,
  Select,
  Spinner,
  Stack,
  TextInput,
} from '@primer/react';
import { SenvApiError, unwrap } from '@senv/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../api-context';
import { useMe } from '../auth/use-me';
import table from '../ui/data-table.module.css';
import panel from '../ui/panel.module.css';
import { type ExampleSource, exampleSourceKey, schemaKey, useExampleSource } from './queries';

const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

const RESULTS: Record<
  NonNullable<ExampleSource['lastResult']>,
  { label: string; variant: 'success' | 'attention' | 'danger' }
> = {
  ok: { label: '확인함', variant: 'success' },
  not_found: { label: '파일 없음', variant: 'danger' },
  no_access: { label: '접근 못 함', variant: 'danger' },
  too_large: { label: '너무 큼', variant: 'attention' },
  error: { label: '확인 실패', variant: 'danger' },
};

const SKIP_REASONS: Record<ExampleSource['skipped'][number]['reason'], string> = {
  invalid_key: '키 이름 규칙에 맞지 않음',
  no_assignment: '=가 없음',
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof SenvApiError ? error.message : fallback;

/**
 * 키 스키마 탭 위의 .env.example 연결 (M1.2, PRD 결정 73~76).
 * 기본 브랜치에 새 키가 들어오면 서버가 선택 키로 등록한다. 연결·끊기는 관리자, 지금 확인은 멤버도 한다
 */
export function ExampleSourcePanel({ project }: { project: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const isAdmin = useMe().data?.role === 'admin';
  const status = useExampleSource(project);
  const [linking, setLinking] = useState(false);
  // 등록한 키가 매트릭스·키 스키마에 바로 보이도록 스키마도 새로 받는다
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: exampleSourceKey(project) }),
      queryClient.invalidateQueries({ queryKey: schemaKey(project) }),
    ]);
  const check = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/projects/{project}/example-source/check', {
          params: { path: { project } },
        }),
      ),
    onSuccess: refresh,
  });
  const unlink = useMutation({
    mutationFn: () =>
      unwrap(
        api.DELETE('/api/v1/projects/{project}/example-source', {
          params: { path: { project } },
        }),
      ),
    onSuccess: refresh,
  });
  const failure = check.error ?? unlink.error;

  return (
    <section className={panel.panel} aria-labelledby="example-source-title">
      <Stack gap="condensed">
        <h3 id="example-source-title" className={panel.title}>
          .env.example 연결
        </h3>
        {status.isPending ? (
          <Spinner size="small" />
        ) : status.isError ? (
          <Flash variant="danger">.env.example 연결을 불러오지 못했습니다.</Flash>
        ) : !status.data.enabled ? (
          <p className={table.muted}>
            GitHub App이 설정되지 않아 쓸 수 없습니다. 서버에 GITHUB_APP_ID·GITHUB_APP_PRIVATE_KEY·
            GITHUB_APP_WEBHOOK_SECRET을 넣으면 켜집니다.
          </p>
        ) : status.data.source === null ? (
          <>
            <p className={table.muted}>
              GitHub 저장소의 .env.example을 연결하면, 기본 브랜치에 새 키가 들어올 때마다 키
              스키마에 선택 키로 등록합니다. 값은 가져오지 않습니다.
            </p>
            {isAdmin && (
              <Stack direction="horizontal">
                <Button onClick={() => setLinking(true)}>저장소 연결</Button>
              </Stack>
            )}
          </>
        ) : (
          <>
            <SourceStatus source={status.data.source} />
            {failure && (
              <Flash variant="danger">{errorMessage(failure, '요청을 처리하지 못했습니다.')}</Flash>
            )}
            <Stack direction="horizontal" gap="condensed" wrap="wrap">
              <Button
                leadingVisual={SyncIcon}
                disabled={check.isPending}
                onClick={() => check.mutate()}
              >
                지금 확인
              </Button>
              {isAdmin && (
                <>
                  <Button onClick={() => setLinking(true)}>연결 바꾸기</Button>
                  <Button
                    variant="danger"
                    disabled={unlink.isPending}
                    onClick={() => unlink.mutate()}
                  >
                    연결 끊기
                  </Button>
                </>
              )}
            </Stack>
          </>
        )}
      </Stack>
      {linking && status.data && (
        <LinkDialog
          project={project}
          installUrl={status.data.installUrl}
          current={status.data.source}
          onClose={() => setLinking(false)}
        />
      )}
    </section>
  );
}

function SourceStatus({ source }: { source: ExampleSource }) {
  const result = source.lastResult ? RESULTS[source.lastResult] : null;
  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
        <Link href={source.fileUrl} target="_blank" rel="noreferrer">
          {`${source.repoFullName} · ${source.path}`}
        </Link>
        {result && <Label variant={result.variant}>{result.label}</Label>}
        {source.lastCheckedAt && (
          <span className={table.muted}>
            {`마지막 확인 ${dateFormat.format(new Date(source.lastCheckedAt))} · 예시의 키 ${source.keys.length}개`}
          </span>
        )}
      </Stack>
      {source.lastMessage && <span className={table.muted}>{source.lastMessage}</span>}
      <KeyNames title="마지막 변경에서 등록한 키" keys={source.lastAdded} />
      <KeyNames title="예시에서 빠진 키 (키 스키마에는 남아 있습니다)" keys={source.lastRemoved} />
      {source.skipped.length > 0 && (
        <span className={table.muted}>
          {`읽지 못한 줄: ${source.skipped
            .map((line) => `${line.line}번째 줄(${SKIP_REASONS[line.reason]})`)
            .join(', ')}`}
        </span>
      )}
    </Stack>
  );
}

function KeyNames({ title, keys }: { title: string; keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
      <span className={table.muted}>{title}</span>
      {keys.map((key) => (
        <code key={key} className={table.key}>
          {key}
        </code>
      ))}
    </Stack>
  );
}

function LinkDialog({
  project,
  installUrl,
  current,
  onClose,
}: {
  project: string;
  installUrl: string | null;
  current: ExampleSource | null;
  onClose: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const repositories = useQuery({
    queryKey: ['github', 'repositories'],
    queryFn: () => unwrap(api.GET('/api/v1/github/repositories')),
  });
  const [repoId, setRepoId] = useState(current ? String(current.repoId) : '');
  const [path, setPath] = useState(current?.path ?? '.env.example');
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT('/api/v1/projects/{project}/example-source', {
          params: { path: { project } },
          body: { repoId: Number(repoId), path: path.trim() },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: exampleSourceKey(project) }),
        queryClient.invalidateQueries({ queryKey: schemaKey(project) }),
      ]);
      onClose();
    },
  });
  const install = installUrl && (
    <Link href={installUrl} target="_blank" rel="noreferrer">
      App 설치
    </Link>
  );

  return (
    <Dialog title=".env.example 연결" width="medium" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Stack gap="normal">
          {save.isError && (
            <Flash variant="danger">{errorMessage(save.error, '연결하지 못했습니다.')}</Flash>
          )}
          {repositories.isPending ? (
            <Spinner size="small" />
          ) : repositories.isError ? (
            <Flash variant="danger">
              {errorMessage(repositories.error, '저장소 목록을 불러오지 못했습니다.')}
            </Flash>
          ) : repositories.data.repositories.length === 0 ? (
            <p className={table.muted}>
              GitHub App이 설치된 저장소가 없습니다. {install}에서 .env.example이 있는 저장소를
              고르세요.
            </p>
          ) : (
            <FormControl>
              <FormControl.Label>저장소</FormControl.Label>
              <Select block value={repoId} onChange={(event) => setRepoId(event.target.value)}>
                <Select.Option value="" disabled>
                  저장소 고르기
                </Select.Option>
                {repositories.data.repositories.map((repo) => (
                  <Select.Option key={repo.id} value={String(repo.id)}>
                    {repo.fullName}
                  </Select.Option>
                ))}
              </Select>
              {install && (
                <FormControl.Caption>목록에 없으면 {install}에서 더하세요</FormControl.Caption>
              )}
            </FormControl>
          )}
          <FormControl>
            <FormControl.Label>파일 경로</FormControl.Label>
            <FormControl.Caption>저장소 루트 기준 (예: apps/web/.env.example)</FormControl.Caption>
            <TextInput
              block
              monospace
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
          </FormControl>
          <Stack direction="horizontal" gap="condensed" justify="end">
            <Button onClick={onClose}>취소</Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!repoId || !path.trim() || save.isPending}
            >
              연결
            </Button>
          </Stack>
        </Stack>
      </form>
    </Dialog>
  );
}
