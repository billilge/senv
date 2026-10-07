import {
  CheckCircleIcon,
  PencilIcon,
  PlusIcon,
  ServerIcon,
  TrashIcon,
} from '@primer/octicons-react';
import {
  Button,
  Checkbox,
  Dialog,
  Flash,
  FormControl,
  Label,
  PageHeader,
  Select,
  Spinner,
  Stack,
  TextInput,
} from '@primer/react';
import { SenvApiError, unwrap } from '@senv/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useApi } from '../api-context';
import {
  CONNECTIONS_KEY,
  providerName,
  type TargetConnection,
  type TargetProvider,
  useConnections,
  useProviders,
} from '../targets/queries';
import table from '../ui/data-table.module.css';
import list from '../ui/list-box.module.css';

const errorText = (error: unknown, fallback: string) =>
  error instanceof SenvApiError ? error.message : fallback;

/** 배포 대상 연결 (관리자, PRD 7.1·8.1, 결정 56) */
export function TargetsPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const providers = useProviders();
  const connections = useConnections();
  const [dialog, setDialog] = useState<{ editing?: TargetConnection } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });

  const test = useMutation({
    mutationFn: async (connection: TargetConnection) => {
      await unwrap(
        api.POST('/api/v1/targets/connections/{id}/test', {
          params: { path: { id: connection.id } },
        }),
      );
      return connection;
    },
    onSuccess: (connection) => setNotice(`${connection.name}: 연결됨`),
  });
  const remove = useMutation({
    mutationFn: (connection: TargetConnection) =>
      unwrap(
        api.DELETE('/api/v1/targets/connections/{id}', {
          params: { path: { id: connection.id } },
        }),
      ),
    onSuccess: refresh,
  });
  const failure = test.error ?? remove.error;

  return (
    <Stack gap="normal">
      <PageHeader>
        <PageHeader.TitleArea>
          <PageHeader.Title as="h2">배포 대상</PageHeader.Title>
        </PageHeader.TitleArea>
        <PageHeader.Description>
          게시한 값을 반영할 인프라 연결입니다. 프로젝트의 배포 탭에서 환경과 리소스를 매핑합니다.
        </PageHeader.Description>
        <PageHeader.Actions>
          <Button variant="primary" leadingVisual={PlusIcon} onClick={() => setDialog({})}>
            연결 추가
          </Button>
        </PageHeader.Actions>
      </PageHeader>
      {notice && <Flash variant="success">{notice}</Flash>}
      {failure && <Flash variant="danger">{errorText(failure, '처리하지 못했습니다.')}</Flash>}
      {connections.isPending ? (
        <Spinner />
      ) : connections.isError ? (
        <Flash variant="danger">
          {errorText(connections.error, '연결 목록을 불러오지 못했습니다.')}
        </Flash>
      ) : (
        <ul className={list.box}>
          {connections.data.connections.map((connection) => (
            <li key={connection.id} className={list.row}>
              <ServerIcon className={list.icon} />
              <span className={list.title}>{connection.name}</span>
              <Label>{providerName(providers.data?.providers, connection.type)}</Label>
              <Stack direction="horizontal" gap="condensed" style={{ marginLeft: 'auto' }}>
                <Button
                  size="small"
                  leadingVisual={CheckCircleIcon}
                  aria-label={`${connection.name} 연결 확인`}
                  disabled={test.isPending}
                  onClick={() => {
                    setNotice(null);
                    test.mutate(connection);
                  }}
                >
                  연결 확인
                </Button>
                <Button
                  size="small"
                  leadingVisual={PencilIcon}
                  aria-label={`${connection.name} 편집`}
                  onClick={() => setDialog({ editing: connection })}
                >
                  편집
                </Button>
                <Button
                  size="small"
                  variant="danger"
                  leadingVisual={TrashIcon}
                  aria-label={`${connection.name} 삭제`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(connection)}
                >
                  삭제
                </Button>
              </Stack>
              <span className={list.description}>
                {Object.values(connection.config)
                  .filter((value) => typeof value === 'string')
                  .join(' · ')}
              </span>
              <span className={list.meta}>
                <span className={table.muted}>매핑 {connection.mappingCount}개</span>
              </span>
            </li>
          ))}
          {connections.data.connections.length === 0 && (
            <li className={list.empty}>
              아직 연결이 없습니다. Coolify 같은 배포 인프라를 연결하세요.
            </li>
          )}
        </ul>
      )}
      {dialog && providers.data && (
        <ConnectionDialog
          providers={providers.data.providers}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      )}
    </Stack>
  );
}

/** 제공자가 내준 필드 명세로 폼을 그린다. 비밀 필드는 가리고, 고칠 때 비우면 기존 값을 쓴다 */
function ConnectionDialog({
  providers,
  editing,
  onClose,
  onSaved,
}: {
  providers: TargetProvider[];
  editing?: TargetConnection;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [type, setType] = useState(editing?.type ?? providers[0]?.type ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [config, setConfig] = useState<Record<string, unknown>>(editing?.config ?? {});
  const provider = providers.find((candidate) => candidate.type === type);
  const save = useMutation({
    mutationFn: () =>
      editing
        ? unwrap(
            api.PATCH('/api/v1/targets/connections/{id}', {
              params: { path: { id: editing.id } },
              body: { name, config },
            }),
          )
        : unwrap(api.POST('/api/v1/targets/connections', { body: { name, type, config } })),
    onSuccess: onSaved,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Dialog title={editing ? `${editing.name} 편집` : '연결 추가'} width="medium" onClose={onClose}>
      <form onSubmit={submit}>
        <Stack gap="normal">
          {save.isError && (
            <Flash variant="danger">{errorText(save.error, '저장하지 못했습니다.')}</Flash>
          )}
          {!editing && (
            <FormControl>
              <FormControl.Label>종류</FormControl.Label>
              <Select block value={type} onChange={(event) => setType(event.target.value)}>
                {providers.map((candidate) => (
                  <Select.Option key={candidate.type} value={candidate.type}>
                    {candidate.displayName}
                  </Select.Option>
                ))}
              </Select>
            </FormControl>
          )}
          <FormControl>
            <FormControl.Label>이름</FormControl.Label>
            <TextInput
              block
              placeholder="coolify-main"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormControl>
          {provider?.connectionFields.map((field) =>
            field.kind === 'boolean' ? (
              <FormControl key={field.name}>
                <Checkbox
                  checked={config[field.name] === true}
                  onChange={(event) => setConfig({ ...config, [field.name]: event.target.checked })}
                />
                <FormControl.Label>{field.label}</FormControl.Label>
              </FormControl>
            ) : (
              <FormControl key={field.name}>
                <FormControl.Label>{field.label}</FormControl.Label>
                {field.description && (
                  <FormControl.Caption>{field.description}</FormControl.Caption>
                )}
                <TextInput
                  block
                  type={field.kind === 'secret' ? 'password' : 'text'}
                  autoComplete="off"
                  placeholder={
                    editing && field.kind === 'secret' ? '비워 두면 그대로 둡니다' : undefined
                  }
                  value={String(config[field.name] ?? '')}
                  onChange={(event) => setConfig({ ...config, [field.name]: event.target.value })}
                />
              </FormControl>
            ),
          )}
          <Stack direction="horizontal" gap="condensed" justify="end">
            <Button onClick={onClose}>취소</Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || save.isPending}>
              {editing ? '저장' : '연결 확인 후 저장'}
            </Button>
          </Stack>
        </Stack>
      </form>
    </Dialog>
  );
}
