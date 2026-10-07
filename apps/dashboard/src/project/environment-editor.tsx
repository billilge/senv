import { PasteIcon, PlusIcon, TrashIcon, UndoIcon } from '@primer/octicons-react';
import {
  Button,
  CounterLabel,
  Flash,
  FormControl,
  Label,
  Stack,
  Textarea,
  TextInput,
} from '@primer/react';
import { unwrap } from '@senv/api-client';
import {
  applyChangeSet,
  createChangeSet,
  DotenvParseError,
  diffVariables,
  hasChanges,
  isValidKeyName,
  parseDotenv,
} from '@senv/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../api-context';
import table from '../ui/data-table.module.css';
import list from '../ui/list-box.module.css';
import panel from '../ui/panel.module.css';
import styles from './environment-editor.module.css';
import { PublishError } from './publish-error';
import { type EnvironmentValues, environmentKey, fetchEnvironmentValues } from './queries';

const KEY_RULE = '키 이름은 대문자·숫자·밑줄만 쓸 수 있고 숫자로 시작할 수 없습니다';

export interface EnvironmentEditorProps {
  project: string;
  values: EnvironmentValues;
  onCancel: () => void;
  onPublished: (version: number) => void;
}

/** 한 환경의 값을 고쳐 변경을 확인한 뒤 한 번에 게시한다 (한 번 게시 = 한 버전) */
export function EnvironmentEditor({
  project,
  values,
  onCancel,
  onPublished,
}: EnvironmentEditorProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const env = values.env;
  const [base, setBase] = useState(values);
  const [draft, setDraft] = useState<Record<string, string>>(values.variables);
  const [reviewing, setReviewing] = useState(false);
  const [rebasedOn, setRebasedOn] = useState<number | null>(null);

  const diff = diffVariables(base.variables, draft);
  const changes = createChangeSet(base.variables, draft);
  const keys = [...new Set([...Object.keys(base.variables), ...Object.keys(draft)])].sort();

  const publish = useMutation({
    mutationFn: (message: string) =>
      unwrap(
        api.POST('/api/v1/projects/{project}/envs/{env}/versions', {
          params: { path: { project, env } },
          body: { baseVersion: base.version, changes, ...(message ? { message } : {}) },
        }),
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: environmentKey(project, env) });
      onPublished(result.version);
    },
  });

  /** 그 사이 게시된 최신 값을 받아 내 변경을 그 위에 다시 얹는다 */
  const reload = async () => {
    const latest = await queryClient.fetchQuery({
      queryKey: environmentKey(project, env),
      queryFn: () => fetchEnvironmentValues(api, project, env),
      staleTime: 0,
    });
    setBase(latest);
    setDraft(applyChangeSet(latest.variables, changes));
    setRebasedOn(latest.version);
    setReviewing(false);
    publish.reset();
  };

  const setValue = (key: string, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const remove = (key: string) =>
    setDraft((current) => Object.fromEntries(Object.entries(current).filter(([k]) => k !== key)));
  const merge = (next: Record<string, string>) => setDraft((current) => ({ ...current, ...next }));

  return (
    <Stack gap="normal">
      <h3 className={styles.heading}>
        {env} 편집
        {base.version === 0 ? (
          <Label variant="secondary">게시 전</Label>
        ) : (
          <CounterLabel>{`기준 v${base.version}`}</CounterLabel>
        )}
      </h3>
      {rebasedOn !== null && (
        <Flash>최신 값(v{rebasedOn}) 위에 내 변경을 다시 얹었습니다. 확인한 뒤 게시하세요.</Flash>
      )}
      {reviewing ? (
        <section aria-label="게시할 변경" className={panel.panel}>
          <Stack gap="normal">
            <h4 className={panel.title}>게시할 변경</h4>
            <ul className={list.box}>
              {diff.added.map((key) => (
                <li key={key} className={list.row}>
                  <Label variant="success">추가</Label> <code className={table.key}>{key}</code>
                </li>
              ))}
              {diff.changed.map((key) => (
                <li key={key} className={list.row}>
                  <Label variant="accent">변경</Label> <code className={table.key}>{key}</code>
                </li>
              ))}
              {diff.removed.map((key) => (
                <li key={key} className={list.row}>
                  <Label variant="danger">삭제</Label> <code className={table.key}>{key}</code>
                </li>
              ))}
            </ul>
            <PublishForm
              pending={publish.isPending}
              error={publish.error}
              onPublish={(message) => publish.mutate(message)}
              onReload={reload}
              onBack={() => setReviewing(false)}
            />
          </Stack>
        </section>
      ) : (
        <>
          {keys.length === 0 ? (
            <div className={list.box}>
              <p className={list.empty}>
                아직 값이 없습니다. 아래에서 키를 추가하거나 .env를 붙여넣으세요.
              </p>
            </div>
          ) : (
            <div className={table.container}>
              <table className={table.table}>
                <thead>
                  <tr>
                    <th scope="col">키</th>
                    <th scope="col">값</th>
                    <th scope="col">
                      <span className={table.muted}>변경</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) =>
                    Object.hasOwn(draft, key) ? (
                      <tr key={key}>
                        <th scope="row" className={table.key}>
                          {key}
                        </th>
                        <td className={styles.valueCell}>
                          <Textarea
                            block
                            resize="vertical"
                            aria-label={`${key} 값`}
                            rows={draft[key]?.includes('\n') ? 4 : 1}
                            value={draft[key]}
                            onChange={(event) => setValue(key, event.target.value)}
                          />
                        </td>
                        <td className={table.actions}>
                          <Stack
                            direction="horizontal"
                            gap="condensed"
                            align="center"
                            justify="end"
                          >
                            {!Object.hasOwn(base.variables, key) && (
                              <Label variant="success">추가됨</Label>
                            )}
                            {diff.changed.includes(key) && <Label variant="accent">바뀜</Label>}
                            <Button
                              size="small"
                              variant="invisible"
                              leadingVisual={TrashIcon}
                              aria-label={`${key} 삭제`}
                              onClick={() => remove(key)}
                            >
                              삭제
                            </Button>
                          </Stack>
                        </td>
                      </tr>
                    ) : (
                      <tr key={key}>
                        <th scope="row" className={`${table.key} ${styles.removed}`}>
                          {key}
                        </th>
                        <td>
                          <Label variant="danger">삭제됨</Label>
                        </td>
                        <td className={table.actions}>
                          <Button
                            size="small"
                            variant="invisible"
                            leadingVisual={UndoIcon}
                            aria-label={`${key} 되살리기`}
                            onClick={() => setValue(key, base.variables[key] ?? '')}
                          >
                            되살리기
                          </Button>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
          <div className={styles.tools}>
            <AddKey existing={draft} onAdd={setValue} />
            <PasteDotenv onApply={merge} />
          </div>
          <Stack direction="horizontal" gap="condensed">
            <Button
              variant="primary"
              disabled={!hasChanges(diff)}
              onClick={() => setReviewing(true)}
            >
              변경 확인
            </Button>
            <Button onClick={onCancel}>취소</Button>
          </Stack>
        </>
      )}
    </Stack>
  );
}

function AddKey({
  existing,
  onAdd,
}: {
  existing: Record<string, string>;
  onAdd: (key: string, value: string) => void;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (!isValidKeyName(key)) return setError(KEY_RULE);
    if (Object.hasOwn(existing, key)) return setError('이미 있는 키입니다. 위에서 값을 고치세요');
    onAdd(key, value);
    setKey('');
    setValue('');
  };

  return (
    <section className={panel.panel} aria-labelledby="add-key-title">
      <h4 id="add-key-title" className={panel.title}>
        키 추가
      </h4>
      <Stack gap="condensed">
        <FormControl>
          <FormControl.Label>새 키</FormControl.Label>
          <TextInput
            block
            monospace
            placeholder="API_URL"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setError(null);
            }}
          />
          {error && <FormControl.Validation variant="error">{error}</FormControl.Validation>}
        </FormControl>
        <FormControl>
          <FormControl.Label>새 값</FormControl.Label>
          <Textarea
            block
            rows={1}
            resize="vertical"
            className={styles.mono}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </FormControl>
        <div>
          <Button leadingVisual={PlusIcon} disabled={!key} onClick={add}>
            추가
          </Button>
        </div>
      </Stack>
    </section>
  );
}

function PasteDotenv({ onApply }: { onApply: (values: Record<string, string>) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    let parsed: Record<string, string>;
    try {
      parsed = parseDotenv(text);
    } catch (cause) {
      if (cause instanceof DotenvParseError) return setError(cause.message);
      throw cause;
    }
    const invalid = Object.keys(parsed).filter((key) => !isValidKeyName(key));
    if (invalid.length > 0) return setError(`${KEY_RULE}: ${invalid.join(', ')}`);
    onApply(parsed);
    setText('');
  };

  return (
    <section className={panel.panel}>
      <Stack gap="condensed">
        <FormControl>
          <FormControl.Label>.env 붙여넣기</FormControl.Label>
          <FormControl.Caption>
            같은 키는 붙여넣은 값으로 바뀌고, 없던 키는 추가됩니다
          </FormControl.Caption>
          <Textarea
            block
            rows={4}
            resize="vertical"
            className={styles.mono}
            placeholder={'API_URL=https://api.example.com\nDEBUG=false'}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
          {error && <FormControl.Validation variant="error">{error}</FormControl.Validation>}
        </FormControl>
        <div>
          <Button leadingVisual={PasteIcon} disabled={!text.trim()} onClick={apply}>
            붙여넣은 값 적용
          </Button>
        </div>
      </Stack>
    </section>
  );
}

function PublishForm({
  pending,
  error,
  onPublish,
  onReload,
  onBack,
}: {
  pending: boolean;
  error: Error | null;
  onPublish: (message: string) => void;
  onReload: () => void;
  onBack: () => void;
}) {
  const [message, setMessage] = useState('');

  return (
    <Stack gap="normal">
      <FormControl>
        <FormControl.Label>게시 메시지</FormControl.Label>
        <FormControl.Caption>선택 사항. 버전 기록에 남습니다</FormControl.Caption>
        <TextInput
          block
          value={message}
          maxLength={500}
          placeholder="예: API 주소 변경"
          onChange={(event) => setMessage(event.target.value)}
        />
      </FormControl>
      {error && (
        <PublishError error={error} reload={{ label: '최신 값 불러오기', onClick: onReload }} />
      )}
      <Stack direction="horizontal" gap="condensed">
        <Button variant="primary" disabled={pending} onClick={() => onPublish(message.trim())}>
          게시
        </Button>
        <Button onClick={onBack}>편집으로 돌아가기</Button>
      </Stack>
    </Stack>
  );
}
