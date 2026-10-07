import {
  HistoryIcon,
  PlusIcon,
  RocketIcon,
  SyncIcon,
  TrashIcon,
  UploadIcon,
} from '@primer/octicons-react';
import {
  Button,
  Checkbox,
  Dialog,
  Flash,
  FormControl,
  Label,
  Select,
  Spinner,
  Stack,
  TextInput,
} from '@primer/react';
import { SenvApiError, unwrap } from '@senv/api-client';
import { type EnvironmentName, versionRo } from '@senv/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useApi } from '../api-context';
import { useMe } from '../auth/use-me';
import {
  ACTION_TEXT,
  providerName,
  type SyncRun,
  type TargetMapping,
  type TargetProvider,
  useConnections,
  useMappings,
  useProviders,
  useResources,
} from '../targets/queries';
import table from '../ui/data-table.module.css';
import list from '../ui/list-box.module.css';
import { projectKey } from './queries';

const errorText = (error: unknown, fallback: string) =>
  error instanceof SenvApiError ? error.message : fallback;
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

const RUN_STATUS = {
  succeeded: { text: '성공', variant: 'success' },
  skipped: { text: '변경 없음', variant: 'secondary' },
  failed: { text: '실패', variant: 'danger' },
} as const;

/** 프로젝트의 배포 대상 매핑 (PRD 7.1·8장, 결정 56) */
export function ProjectTargets({
  project,
  envs,
}: {
  project: string;
  envs: readonly EnvironmentName[];
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const me = useMe();
  const isAdmin = me.data?.role === 'admin';
  const providers = useProviders();
  const mappings = useMappings(project);
  const [syncing, setSyncing] = useState<TargetMapping | null>(null);
  const [importing, setImporting] = useState<TargetMapping | null>(null);
  const [adding, setAdding] = useState(false);
  const [openRuns, setOpenRuns] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 동기화·가져오기는 값과 매핑 상태를 모두 바꾸므로 프로젝트 아래를 함께 새로 받는다
  const refresh = () => queryClient.invalidateQueries({ queryKey: projectKey(project) });

  const drift = useMutation({
    mutationFn: (mapping: TargetMapping) =>
      unwrap(
        api.POST('/api/v1/targets/mappings/{id}/drift', { params: { path: { id: mapping.id } } }),
      ),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (mapping: TargetMapping) =>
      unwrap(api.DELETE('/api/v1/targets/mappings/{id}', { params: { path: { id: mapping.id } } })),
    onSuccess: refresh,
  });
  const failure = drift.error ?? remove.error;

  if (mappings.isPending) return <Spinner />;
  if (mappings.isError) {
    return (
      <Flash variant="danger">{errorText(mappings.error, '매핑을 불러오지 못했습니다.')}</Flash>
    );
  }

  return (
    <Stack gap="normal">
      {isAdmin && (
        <Stack direction="horizontal" justify="end">
          <Button variant="primary" leadingVisual={PlusIcon} onClick={() => setAdding(true)}>
            매핑 추가
          </Button>
        </Stack>
      )}
      {notice && <Flash variant="success">{notice}</Flash>}
      {failure && <Flash variant="danger">{errorText(failure, '처리하지 못했습니다.')}</Flash>}
      <ul className={list.box}>
        {mappings.data.mappings.map((mapping) => {
          const run = mapping.lastRun;
          const infra = providerName(providers.data?.providers, mapping.connection.type);
          return (
            <li key={mapping.id} className={list.row}>
              <RocketIcon className={list.icon} />
              <Label variant="accent">{mapping.env}</Label>
              <span className={list.title}>{mapping.resourceName}</span>
              <span className={table.muted}>
                {mapping.connection.name} · {mapping.syncMode === 'auto' ? '게시하면 자동' : '수동'}
              </span>
              <Stack
                direction="horizontal"
                gap="condensed"
                wrap="wrap"
                style={{ marginLeft: 'auto' }}
              >
                <Button
                  size="small"
                  leadingVisual={SyncIcon}
                  aria-label={`${mapping.resourceName} 지금 동기화`}
                  onClick={() => {
                    setNotice(null);
                    setSyncing(mapping);
                  }}
                >
                  지금 동기화
                </Button>
                <Button
                  size="small"
                  leadingVisual={HistoryIcon}
                  aria-label={`${mapping.resourceName} 기록`}
                  onClick={() => setOpenRuns(openRuns === mapping.id ? null : mapping.id)}
                >
                  기록
                </Button>
                <Button
                  size="small"
                  leadingVisual={UploadIcon}
                  aria-label={`${mapping.resourceName} 가져오기`}
                  onClick={() => {
                    setNotice(null);
                    setImporting(mapping);
                  }}
                >
                  가져오기
                </Button>
                <Button
                  size="small"
                  variant="invisible"
                  aria-label={`${mapping.resourceName} 드리프트 확인`}
                  disabled={drift.isPending}
                  onClick={() => drift.mutate(mapping)}
                >
                  드리프트 확인
                </Button>
                {isAdmin && (
                  <Button
                    size="small"
                    variant="invisible"
                    leadingVisual={TrashIcon}
                    aria-label={`${mapping.resourceName} 매핑 삭제`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(mapping)}
                  >
                    삭제
                  </Button>
                )}
              </Stack>
              <span className={list.meta}>
                {mapping.lastSync ? (
                  <span className={table.muted}>
                    v{mapping.lastSync.version} 반영 ·{' '}
                    {dateFormat.format(new Date(mapping.lastSync.at))}
                  </span>
                ) : (
                  <span className={table.muted}>아직 동기화하지 않았습니다</span>
                )}
                {run && (
                  <Label variant={RUN_STATUS[run.status].variant}>
                    {RUN_STATUS[run.status].text}
                  </Label>
                )}
                {run?.status === 'failed' && run.error && (
                  <span className={table.muted}>{run.error}</span>
                )}
              </span>
              {mapping.driftKeys.length > 0 && (
                <span className={list.description}>
                  <Flash variant="warning">
                    {infra}에서 직접 바뀐 키: {mapping.driftKeys.join(', ')}. 지금 동기화로 대시보드
                    값으로 덮어쓰거나, 가져오기로 원격 값을 새 버전으로 게시하세요.
                  </Flash>
                </span>
              )}
              {openRuns === mapping.id && (
                <span className={list.description}>
                  <Runs mappingId={mapping.id} />
                </span>
              )}
            </li>
          );
        })}
        {mappings.data.mappings.length === 0 && (
          <li className={list.empty}>
            아직 매핑이 없습니다. {isAdmin ? '매핑을 추가하면' : '관리자가 매핑을 추가하면'} 게시할
            때 배포 대상에 값이 반영됩니다.
          </li>
        )}
      </ul>
      {syncing && (
        <SyncDialog
          mapping={syncing}
          onClose={() => setSyncing(null)}
          onDone={async (run) => {
            setSyncing(null);
            setNotice(
              run.status === 'skipped'
                ? `${syncing.resourceName}: 바뀐 값이 없어 아무것도 하지 않았습니다`
                : `${syncing.resourceName}에 ${run.changedKeys.length}개 키를 반영${run.action ? `하고 ${ACTION_TEXT[run.action]}` : ''}했습니다`,
            );
            await refresh();
          }}
        />
      )}
      {importing && (
        <ImportDialog
          mapping={importing}
          infra={providerName(providers.data?.providers, importing.connection.type)}
          onClose={() => setImporting(null)}
          onDone={async (result) => {
            setImporting(null);
            setNotice(
              `${result.keys.length}개 키를 ${importing.env} ${versionRo(result.version)} 게시했습니다`,
            );
            await refresh();
          }}
        />
      )}
      {adding && providers.data && (
        <AddMappingDialog
          project={project}
          envs={envs}
          providers={providers.data.providers}
          onClose={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      )}
    </Stack>
  );
}

function SyncDialog({
  mapping,
  onClose,
  onDone,
}: {
  mapping: TargetMapping;
  onClose: () => void;
  onDone: (run: SyncRun) => void;
}) {
  const api = useApi();
  const plan = useQuery({
    queryKey: ['targets', 'mappings', mapping.id, 'plan'],
    staleTime: 0,
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/targets/mappings/{id}/plan', { params: { path: { id: mapping.id } } }),
      ),
  });
  const sync = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/targets/mappings/{id}/sync', { params: { path: { id: mapping.id } } }),
      ),
    onSuccess: onDone,
  });
  const changes = plan.data
    ? [
        ...plan.data.add.map((key) => ['추가', 'success', key] as const),
        ...plan.data.change.map((key) => ['변경', 'accent', key] as const),
        ...plan.data.remove.map((key) => ['삭제', 'danger', key] as const),
      ]
    : [];

  return (
    <Dialog title={`${mapping.resourceName} 동기화`} width="large" onClose={onClose}>
      <Stack gap="normal">
        {plan.isPending && <Spinner size="small" />}
        {plan.isError && (
          <Flash variant="danger">{errorText(plan.error, '계획을 만들지 못했습니다.')}</Flash>
        )}
        {plan.data && (
          <>
            <p className={table.muted}>
              {mapping.env} v{plan.data.version}(shared v{plan.data.sharedVersion})을 반영합니다.
              값은 보여주지 않습니다.
            </p>
            {changes.length === 0 ? (
              <div className={list.box}>
                <p className={list.empty}>바뀐 키가 없습니다.</p>
              </div>
            ) : (
              <ul className={list.box}>
                {changes.map(([text, variant, key]) => (
                  <li key={key} className={list.row}>
                    <Label variant={variant}>{text}</Label> <code className={table.key}>{key}</code>
                  </li>
                ))}
              </ul>
            )}
            <p className={table.muted}>
              그대로인 키 {plan.data.unchanged}개 ·{' '}
              {plan.data.action
                ? `반영 후 ${ACTION_TEXT[plan.data.action]}`
                : '반영 후 아무것도 하지 않음'}
            </p>
          </>
        )}
        {sync.isError && (
          <Flash variant="danger">{errorText(sync.error, '동기화하지 못했습니다.')}</Flash>
        )}
        <Stack direction="horizontal" gap="condensed" justify="end">
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            disabled={!plan.data || changes.length === 0 || sync.isPending}
            onClick={() => sync.mutate()}
          >
            동기화
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

function ImportDialog({
  mapping,
  infra,
  onClose,
  onDone,
}: {
  mapping: TargetMapping;
  infra: string;
  onClose: () => void;
  onDone: (result: { version: number; keys: string[] }) => void;
}) {
  const api = useApi();
  const importRemote = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/targets/mappings/{id}/import', { params: { path: { id: mapping.id } } }),
      ),
    onSuccess: onDone,
  });

  return (
    <Dialog title="원격 값 가져오기" width="medium" onClose={onClose}>
      <Stack gap="normal">
        <p className={table.muted}>
          {infra}의 {mapping.resourceName}에 있는 값 중 {mapping.env}의 지금 값과 다른 것을 새
          버전으로 게시합니다. 스키마에 없는 키는 secret·필수로 등록합니다.
        </p>
        {importRemote.isError && (
          <Flash variant="danger">{errorText(importRemote.error, '가져오지 못했습니다.')}</Flash>
        )}
        <Stack direction="horizontal" gap="condensed" justify="end">
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            disabled={importRemote.isPending}
            onClick={() => importRemote.mutate()}
          >
            가져오기
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

function Runs({ mappingId }: { mappingId: string }) {
  const api = useApi();
  const runs = useQuery({
    queryKey: ['targets', 'mappings', mappingId, 'runs'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/targets/mappings/{id}/runs', { params: { path: { id: mappingId } } }),
      ),
  });
  if (runs.isPending) return <Spinner size="small" />;
  if (runs.isError) return <Flash variant="danger">기록을 불러오지 못했습니다.</Flash>;
  if (runs.data.runs.length === 0)
    return <span className={table.muted}>아직 기록이 없습니다.</span>;
  return (
    <ul className={list.box}>
      {runs.data.runs.map((run) => (
        <li key={run.id} className={list.row}>
          <Label variant={RUN_STATUS[run.status].variant}>{RUN_STATUS[run.status].text}</Label>
          <span className={table.muted}>
            {dateFormat.format(new Date(run.finishedAt))} ·{' '}
            {run.trigger === 'publish' ? '게시' : '수동'}
            {run.attempt > 1 ? ` (${run.attempt}번째)` : ''}
          </span>
          <span>{`v${run.version} · ${run.changedKeys.join(', ') || '바뀐 키 없음'}`}</span>
          {run.action && <Label>{ACTION_TEXT[run.action]}</Label>}
          {run.error && <span className={list.description}>{run.error}</span>}
        </li>
      ))}
    </ul>
  );
}

function AddMappingDialog({
  project,
  envs,
  providers,
  onClose,
  onDone,
}: {
  project: string;
  envs: readonly EnvironmentName[];
  providers: TargetProvider[];
  onClose: () => void;
  onDone: () => void;
}) {
  const api = useApi();
  const connections = useConnections();
  const [connectionId, setConnectionId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [env, setEnv] = useState<EnvironmentName | ''>('');
  const [syncMode, setSyncMode] = useState<'auto' | 'manual'>('auto');
  const [afterSync, setAfterSync] = useState<'auto' | 'none' | 'restart' | 'redeploy'>('auto');
  const [unmanaged, setUnmanaged] = useState<'keep' | 'delete'>('keep');
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const resources = useResources(connectionId);
  const connection = connections.data?.connections.find(
    (candidate) => candidate.id === connectionId,
  );
  const provider = providers.find((candidate) => candidate.type === connection?.type);
  const patterns = (text: string) =>
    text
      .split(',')
      .map((pattern) => pattern.trim())
      .filter(Boolean);

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/projects/{project}/targets', {
          params: { path: { project } },
          body: {
            connectionId,
            env: env as EnvironmentName,
            resourceId,
            syncMode,
            afterSync,
            unmanaged,
            include: patterns(include),
            exclude: patterns(exclude),
            options: Object.fromEntries(
              (provider?.mappingOptionFields ?? []).map((field) => [
                field.name,
                field.kind === 'boolean'
                  ? options[field.name] === true
                  : (options[field.name] ?? ''),
              ]),
            ),
          },
        }),
      ),
    onSuccess: onDone,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Dialog title="매핑 추가" width="large" onClose={onClose}>
      <form onSubmit={submit}>
        <Stack gap="normal">
          {create.isError && (
            <Flash variant="danger">{errorText(create.error, '만들지 못했습니다.')}</Flash>
          )}
          <FormControl>
            <FormControl.Label>연결</FormControl.Label>
            <Select
              block
              placeholder="연결을 고르세요"
              value={connectionId}
              onChange={(event) => {
                setConnectionId(event.target.value);
                setResourceId('');
              }}
            >
              {connections.data?.connections.map((candidate) => (
                <Select.Option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </Select.Option>
              ))}
            </Select>
          </FormControl>
          {connectionId && (
            <FormControl>
              <FormControl.Label>리소스</FormControl.Label>
              {resources.isPending ? (
                <Spinner size="small" />
              ) : resources.isError ? (
                <Flash variant="danger">
                  {errorText(resources.error, '리소스를 불러오지 못했습니다.')}
                </Flash>
              ) : (
                <Select
                  block
                  placeholder="리소스를 고르세요"
                  value={resourceId}
                  onChange={(event) => setResourceId(event.target.value)}
                >
                  {resources.data.resources.map((resource) => (
                    <Select.Option key={resource.id} value={resource.id}>
                      {resource.description
                        ? `${resource.name} (${resource.description})`
                        : resource.name}
                    </Select.Option>
                  ))}
                </Select>
              )}
            </FormControl>
          )}
          <FormControl>
            <FormControl.Label>환경</FormControl.Label>
            <Select
              block
              placeholder="환경을 고르세요"
              value={env}
              onChange={(event) => setEnv(event.target.value as EnvironmentName)}
            >
              {envs.map((name) => (
                <Select.Option key={name} value={name}>
                  {name}
                </Select.Option>
              ))}
            </Select>
          </FormControl>
          <Stack direction="horizontal" gap="normal" wrap="wrap">
            <FormControl>
              <FormControl.Label>동기화 방식</FormControl.Label>
              <Select
                value={syncMode}
                onChange={(event) => setSyncMode(event.target.value as 'auto' | 'manual')}
              >
                <Select.Option value="auto">게시하면 자동</Select.Option>
                <Select.Option value="manual">수동</Select.Option>
              </Select>
            </FormControl>
            <FormControl>
              <FormControl.Label>반영 후 동작</FormControl.Label>
              <Select
                value={afterSync}
                onChange={(event) => setAfterSync(event.target.value as typeof afterSync)}
              >
                <Select.Option value="auto">자동 판단</Select.Option>
                <Select.Option value="none">아무것도 하지 않음</Select.Option>
                {(provider?.capabilities.actions ?? ['restart', 'redeploy']).map((action) => (
                  <Select.Option key={action} value={action}>
                    {action === 'restart' ? '재시작' : '재배포'}
                  </Select.Option>
                ))}
              </Select>
            </FormControl>
            {(provider?.capabilities.deleteKeys ?? true) && (
              <FormControl>
                <FormControl.Label>관리 밖 키</FormControl.Label>
                <Select
                  value={unmanaged}
                  onChange={(event) => setUnmanaged(event.target.value as 'keep' | 'delete')}
                >
                  <Select.Option value="keep">유지</Select.Option>
                  <Select.Option value="delete">삭제</Select.Option>
                </Select>
              </FormControl>
            )}
          </Stack>
          <Stack direction="horizontal" gap="normal" wrap="wrap">
            <FormControl>
              <FormControl.Label>포함할 키</FormControl.Label>
              <FormControl.Caption>쉼표로 구분, 비우면 전체 (예: VITE_*)</FormControl.Caption>
              <TextInput
                monospace
                value={include}
                onChange={(event) => setInclude(event.target.value)}
              />
            </FormControl>
            <FormControl>
              <FormControl.Label>제외할 키</FormControl.Label>
              <FormControl.Caption>쉼표로 구분 (예: SENTRY_*)</FormControl.Caption>
              <TextInput
                monospace
                value={exclude}
                onChange={(event) => setExclude(event.target.value)}
              />
            </FormControl>
          </Stack>
          {provider?.mappingOptionFields.map((field) =>
            field.kind === 'boolean' ? (
              <FormControl key={field.name}>
                <Checkbox
                  checked={options[field.name] === true}
                  onChange={(event) =>
                    setOptions({ ...options, [field.name]: event.target.checked })
                  }
                />
                <FormControl.Label>{field.label}</FormControl.Label>
              </FormControl>
            ) : (
              <FormControl key={field.name}>
                <FormControl.Label>{field.label}</FormControl.Label>
                <TextInput
                  value={String(options[field.name] ?? '')}
                  onChange={(event) => setOptions({ ...options, [field.name]: event.target.value })}
                />
              </FormControl>
            ),
          )}
          <Stack direction="horizontal" gap="condensed" justify="end">
            <Button onClick={onClose}>취소</Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!connectionId || !resourceId || !env || create.isPending}
            >
              매핑 만들기
            </Button>
          </Stack>
        </Stack>
      </form>
    </Dialog>
  );
}
