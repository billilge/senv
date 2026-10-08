import {
  DeviceDesktopIcon,
  FileDirectoryIcon,
  PlusIcon,
  SyncIcon,
  TrashIcon,
} from '@primer/octicons-react';
import {
  Button,
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
import { isValidLocalPath, SHARED_PROJECT_NAME } from '@senv/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useApi } from '../api-context';
import { linkSummary } from '../local/link-status';
import {
  type AgentDevice,
  DEVICES_KEY,
  isRunning,
  LOCAL_LINKS_KEY,
  type LocalLink,
  useDevices,
  useLocalLinks,
} from '../local/queries';
import { useProjects } from '../project/queries';
import table from '../ui/data-table.module.css';
import list from '../ui/list-box.module.css';

const errorText = (error: unknown, fallback: string) =>
  error instanceof SenvApiError ? error.message : fallback;

const STATUS: Record<
  LocalLink['status'],
  { label: string; variant: 'success' | 'attention' | 'secondary' }
> = {
  active: { label: '활성', variant: 'success' },
  pending: { label: '승인 대기', variant: 'attention' },
  paused: { label: '일시정지', variant: 'secondary' },
};

/** 로컬 자동 받기: 내 PC와 폴더 연결 (M1.1, PRD 결정 60~63) */
export function LocalLinksPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const devices = useDevices();
  const links = useLocalLinks();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: LOCAL_LINKS_KEY }),
      queryClient.invalidateQueries({ queryKey: DEVICES_KEY }),
    ]);
  const byId = (link: LocalLink) => ({ params: { path: { id: link.id } } });

  const pause = useMutation({
    mutationFn: (link: LocalLink) =>
      unwrap(
        api.PATCH('/api/v1/me/local-links/{id}', {
          ...byId(link),
          body: { paused: link.status !== 'paused' },
        }),
      ),
    onSuccess: refresh,
  });
  const overwrite = useMutation({
    mutationFn: (link: LocalLink) =>
      unwrap(api.POST('/api/v1/me/local-links/{id}/overwrite', byId(link))),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (link: LocalLink) => unwrap(api.DELETE('/api/v1/me/local-links/{id}', byId(link))),
    onSuccess: refresh,
  });
  const removeDevice = useMutation({
    mutationFn: (device: AgentDevice) =>
      unwrap(api.DELETE('/api/v1/me/devices/{id}', { params: { path: { id: device.id } } })),
    onSuccess: refresh,
  });
  const failure = pause.error ?? overwrite.error ?? remove.error ?? removeDevice.error;
  const deviceList = devices.data?.devices ?? [];

  return (
    <Stack gap="normal">
      <PageHeader>
        <PageHeader.TitleArea>
          <PageHeader.Title as="h2">내 로컬 연결</PageHeader.Title>
        </PageHeader.TitleArea>
        <PageHeader.Description>
          local 값이 게시되면 내 PC의 폴더에 있는 값 파일(.env.local 등)을 senv agent가 자동으로
          바꿉니다. 대시보드에서 추가한 연결은 그 PC에서 한 번 승인해야 씁니다.
        </PageHeader.Description>
        <PageHeader.Actions>
          <Button
            variant="primary"
            leadingVisual={PlusIcon}
            disabled={deviceList.length === 0}
            onClick={() => setAdding(true)}
          >
            연결 추가
          </Button>
        </PageHeader.Actions>
      </PageHeader>
      {notice && <Flash variant="success">{notice}</Flash>}
      {failure && <Flash variant="danger">{errorText(failure, '처리하지 못했습니다.')}</Flash>}

      <h3>내 PC</h3>
      {devices.isPending ? (
        <Spinner />
      ) : devices.isError ? (
        <Flash variant="danger">
          {errorText(devices.error, '기기 목록을 불러오지 못했습니다.')}
        </Flash>
      ) : (
        <ul className={list.box}>
          {deviceList.map((device) => (
            <li key={device.id} className={list.row}>
              <DeviceDesktopIcon className={list.icon} />
              <span className={list.title}>{device.name}</span>
              {isRunning(device) && <Label variant="success">실행 중</Label>}
              <Button
                size="small"
                variant="danger"
                leadingVisual={TrashIcon}
                aria-label={`${device.name} 삭제`}
                style={{ marginLeft: 'auto' }}
                disabled={removeDevice.isPending}
                onClick={() => removeDevice.mutate(device)}
              >
                삭제
              </Button>
              <span className={list.meta}>
                <span className={table.muted}>
                  {device.lastSeenAt
                    ? `마지막 확인 ${new Date(device.lastSeenAt).toLocaleString('ko-KR')}`
                    : '아직 확인하지 않음'}
                </span>
              </span>
            </li>
          ))}
          {deviceList.length === 0 && (
            <li className={list.empty}>
              등록된 PC가 없습니다. 값을 받을 PC에서 <code>senv agent install</code>을 실행하세요.
            </li>
          )}
        </ul>
      )}

      <h3>연결</h3>
      {links.isPending ? (
        <Spinner />
      ) : links.isError ? (
        <Flash variant="danger">{errorText(links.error, '연결 목록을 불러오지 못했습니다.')}</Flash>
      ) : (
        <ul className={list.box}>
          {links.data.links.map((link) => {
            const status = STATUS[link.status];
            const modified = link.lastState?.state === 'modified';
            return (
              <li key={link.id} className={list.row}>
                <FileDirectoryIcon className={list.icon} />
                <span className={list.title}>{link.path}</span>
                <Label>{link.project}</Label>
                <Label variant={status.variant}>{status.label}</Label>
                <Stack direction="horizontal" gap="condensed" style={{ marginLeft: 'auto' }}>
                  {modified && !link.overwriteRequested && (
                    <Button
                      size="small"
                      leadingVisual={SyncIcon}
                      aria-label={`${link.path} 덮어쓰기`}
                      disabled={overwrite.isPending}
                      onClick={() => overwrite.mutate(link)}
                    >
                      덮어쓰기
                    </Button>
                  )}
                  {link.status !== 'pending' && (
                    <Button
                      size="small"
                      aria-label={`${link.path} ${link.status === 'paused' ? '다시 켜기' : '일시정지'}`}
                      disabled={pause.isPending}
                      onClick={() => pause.mutate(link)}
                    >
                      {link.status === 'paused' ? '다시 켜기' : '일시정지'}
                    </Button>
                  )}
                  <Button
                    size="small"
                    variant="danger"
                    leadingVisual={TrashIcon}
                    aria-label={`${link.path} 삭제`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(link)}
                  >
                    삭제
                  </Button>
                </Stack>
                <span className={list.description}>
                  {link.device.name} · {linkSummary(link)}
                  {link.status === 'pending' && (
                    <>
                      {' '}
                      <code>senv link approve {link.id}</code>
                    </>
                  )}
                  {link.overwriteRequested && ' · 다음 확인 때 덮어씁니다'}
                </span>
              </li>
            );
          })}
          {links.data.links.length === 0 && <li className={list.empty}>아직 연결이 없습니다.</li>}
        </ul>
      )}

      {adding && (
        <AddLinkDialog
          devices={deviceList}
          onClose={() => setAdding(false)}
          onAdded={async (link) => {
            setAdding(false);
            setNotice(
              `${link.project} → ${link.path} 연결을 추가했습니다. ${link.device.name}에서 senv link approve ${link.id}로 승인하면 씁니다.`,
            );
            await refresh();
          }}
        />
      )}
    </Stack>
  );
}

function AddLinkDialog({
  devices,
  onClose,
  onAdded,
}: {
  devices: AgentDevice[];
  onClose: () => void;
  onAdded: (link: LocalLink) => void;
}) {
  const api = useApi();
  const projects = useProjects();
  const choices = (projects.data?.projects ?? []).filter(
    (project) => project.name !== SHARED_PROJECT_NAME,
  );
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? '');
  const [project, setProject] = useState('');
  const [path, setPath] = useState('');
  const chosenProject = project || choices[0]?.name || '';
  const pathInvalid = path !== '' && !isValidLocalPath(path);
  const add = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/me/local-links', { body: { deviceId, project: chosenProject, path } }),
      ),
    onSuccess: onAdded,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate();
  };

  return (
    <Dialog title="연결 추가" width="medium" onClose={onClose}>
      <form onSubmit={submit}>
        <Stack gap="normal">
          {add.isError && (
            <Flash variant="danger">{errorText(add.error, '추가하지 못했습니다.')}</Flash>
          )}
          <FormControl>
            <FormControl.Label>기기</FormControl.Label>
            <Select block value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
              {devices.map((device) => (
                <Select.Option key={device.id} value={device.id}>
                  {device.name}
                </Select.Option>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <FormControl.Label>프로젝트</FormControl.Label>
            <Select
              block
              value={chosenProject}
              onChange={(event) => setProject(event.target.value)}
            >
              {choices.map((choice) => (
                <Select.Option key={choice.name} value={choice.name}>
                  {choice.name}
                </Select.Option>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <FormControl.Label>폴더 경로</FormControl.Label>
            <FormControl.Caption>
              그 PC에서 senv.json이 있는 폴더의 절대 경로 (예: /Users/me/work/web)
            </FormControl.Caption>
            <TextInput
              block
              autoComplete="off"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
            {pathInvalid && (
              <FormControl.Validation variant="error">
                절대 경로여야 합니다 (.. 없이, 512자 이하)
              </FormControl.Validation>
            )}
          </FormControl>
          <Stack direction="horizontal" gap="condensed" justify="end">
            <Button onClick={onClose}>취소</Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!deviceId || !chosenProject || path === '' || pathInvalid || add.isPending}
            >
              추가
            </Button>
          </Stack>
        </Stack>
      </form>
    </Dialog>
  );
}
