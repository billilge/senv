import { HistoryIcon, XIcon } from '@primer/octicons-react';
import {
  Button,
  Dialog,
  Flash,
  FormControl,
  IconButton,
  Label,
  SegmentedControl,
  Spinner,
  Stack,
  TextInput,
} from '@primer/react';
import { unwrap } from '@senv/api-client';
import { type EnvironmentName, versionRo } from '@senv/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../api-context';
import table from '../ui/data-table.module.css';
import list from '../ui/list-box.module.css';
import panel from '../ui/panel.module.css';
import { DiffList } from './diff-list';
import { PublishError } from './publish-error';
import { environmentKey, useVersions, useVersionValues, type VersionInfo } from './queries';

const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

export interface VersionHistoryProps {
  project: string;
  envs: readonly EnvironmentName[];
  env: EnvironmentName;
  onEnvChange: (env: EnvironmentName) => void;
}

/** 환경별 버전 기록: 이전 버전과 비교, 지난 버전으로 되돌리기 (PRD 7.1, 결정 40·41) */
export function VersionHistory({ project, envs, env, onEnvChange }: VersionHistoryProps) {
  return (
    <Stack gap="normal">
      <SegmentedControl
        aria-label="환경"
        onChange={(index) => {
          const next = envs[index];
          if (next) onEnvChange(next);
        }}
      >
        {envs.map((name) => (
          <SegmentedControl.Button key={name} selected={name === env}>
            {name}
          </SegmentedControl.Button>
        ))}
      </SegmentedControl>
      {/* 환경이 바뀌면 비교·되돌리기 상태를 버린다 */}
      <EnvironmentHistory key={env} project={project} env={env} />
    </Stack>
  );
}

function EnvironmentHistory({ project, env }: { project: string; env: EnvironmentName }) {
  const versions = useVersions(project, env);
  const [comparing, setComparing] = useState<number | null>(null);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (versions.isPending) return <Spinner />;
  if (versions.isError) return <Flash variant="danger">버전 기록을 불러오지 못했습니다.</Flash>;

  const items = versions.data.versions;
  const current = items[0]?.version ?? 0;
  if (items.length === 0) {
    return (
      <div className={list.box}>
        <p className={list.empty}>아직 게시한 버전이 없습니다.</p>
      </div>
    );
  }

  return (
    <Stack gap="normal">
      {notice && <Flash variant="success">{notice}</Flash>}
      {comparing !== null && (
        <Compare
          project={project}
          env={env}
          from={comparing - 1}
          to={comparing}
          onClose={() => setComparing(null)}
        />
      )}
      <ul className={list.box}>
        {items.map((item) => (
          <VersionRow
            key={item.version}
            item={item}
            isCurrent={item.version === current}
            onCompare={() => setComparing(item.version)}
            onRollback={() => {
              setNotice(null);
              setRollingBack(item.version);
            }}
          />
        ))}
      </ul>
      {rollingBack !== null && (
        <RollbackDialog
          project={project}
          env={env}
          toVersion={rollingBack}
          current={current}
          onClose={() => setRollingBack(null)}
          onDone={(version) => {
            setNotice(`${versionRo(rollingBack)} 되돌렸습니다: ${env} v${version}`);
            setRollingBack(null);
            setComparing(null);
          }}
        />
      )}
    </Stack>
  );
}

function VersionRow({
  item,
  isCurrent,
  onCompare,
  onRollback,
}: {
  item: VersionInfo;
  isCurrent: boolean;
  onCompare: () => void;
  onRollback: () => void;
}) {
  return (
    <li className={list.row}>
      <HistoryIcon className={list.icon} />
      <span className={table.key}>v{item.version}</span>
      <span>{item.message || '메시지 없음'}</span>
      {isCurrent && <Label variant="success">현재</Label>}
      <Stack direction="horizontal" gap="condensed" style={{ marginLeft: 'auto' }}>
        <Button size="small" aria-label={`v${item.version} 이전과 비교`} onClick={onCompare}>
          이전과 비교
        </Button>
        {!isCurrent && (
          <Button
            size="small"
            aria-label={`${versionRo(item.version)} 되돌리기`}
            onClick={onRollback}
          >
            되돌리기
          </Button>
        )}
      </Stack>
      <span className={list.description}>
        {item.author.login ?? '토큰'} · {dateFormat.format(new Date(item.createdAt))}
      </span>
    </li>
  );
}

function Compare({
  project,
  env,
  from,
  to,
  onClose,
}: {
  project: string;
  env: EnvironmentName;
  from: number;
  to: number;
  onClose: () => void;
}) {
  const before = useVersionValues(project, env, from);
  const after = useVersionValues(project, env, to);
  const title = `v${from} → v${to} 비교`;

  return (
    <section aria-label={title} className={panel.panel}>
      <Stack gap="condensed">
        <Stack direction="horizontal" align="center" justify="space-between">
          <h3 className={panel.title}>{title}</h3>
          <IconButton icon={XIcon} variant="invisible" aria-label="비교 닫기" onClick={onClose} />
        </Stack>
        {before.isError || after.isError ? (
          <Flash variant="danger">버전 값을 불러오지 못했습니다.</Flash>
        ) : before.data && after.data ? (
          <DiffList before={before.data.variables} after={after.data.variables} />
        ) : (
          <Spinner size="small" />
        )}
      </Stack>
    </section>
  );
}

function RollbackDialog({
  project,
  env,
  toVersion,
  current,
  onClose,
  onDone,
}: {
  project: string;
  env: EnvironmentName;
  toVersion: number;
  current: number;
  onClose: () => void;
  onDone: (version: number) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const now = useVersionValues(project, env, current);
  const target = useVersionValues(project, env, toVersion);
  const rollback = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/projects/{project}/envs/{env}/rollback', {
          params: { path: { project, env } },
          body: {
            toVersion,
            baseVersion: current,
            ...(message.trim() ? { message: message.trim() } : {}),
          },
        }),
      ),
    onSuccess: async (result) => {
      // 값과 버전 기록을 함께 새로 받는다 (versionsKey가 environmentKey 아래에 있다)
      await queryClient.invalidateQueries({ queryKey: environmentKey(project, env) });
      onDone(result.version);
    },
  });

  return (
    <Dialog title={`${versionRo(toVersion)} 되돌리기`} width="large" onClose={onClose}>
      <Stack gap="normal">
        <p className={table.muted}>
          {env}의 현재 값(v{current})을 v{toVersion}의 값으로 바꿔 새 버전으로 게시합니다. 기록은
          지우지 않습니다.
        </p>
        {now.data && target.data ? (
          <DiffList before={now.data.variables} after={target.data.variables} />
        ) : (
          <Spinner size="small" />
        )}
        <FormControl>
          <FormControl.Label>메시지</FormControl.Label>
          <TextInput
            block
            maxLength={500}
            placeholder={`${versionRo(toVersion)} 되돌림`}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </FormControl>
        {rollback.error && (
          <PublishError
            error={rollback.error}
            reload={{
              label: '최신 기록 불러오기',
              onClick: () => {
                void queryClient.invalidateQueries({ queryKey: environmentKey(project, env) });
                onClose();
              },
            }}
          />
        )}
        <Stack direction="horizontal" gap="condensed" justify="end">
          <Button onClick={onClose}>취소</Button>
          <Button variant="danger" disabled={rollback.isPending} onClick={() => rollback.mutate()}>
            되돌리기
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
