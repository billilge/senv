import { PencilIcon, PlusIcon, TrashIcon } from '@primer/octicons-react';
import {
  Button,
  Checkbox,
  CheckboxGroup,
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
import type { EnvironmentName } from '@senv/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../api-context';
import { useMe } from '../auth/use-me';
import table from '../ui/data-table.module.css';
import list from '../ui/list-box.module.css';
import panel from '../ui/panel.module.css';
import { type KeySchema, schemaKey, useEnvironmentValues, useKeySchema } from './queries';

type KeyFields = Omit<KeySchema, 'key'>;

const TYPES: { value: KeySchema['type']; label: string }[] = [
  { value: 'string', label: 'string (문자열)' },
  { value: 'url', label: 'url (주소)' },
  { value: 'number', label: 'number (숫자)' },
  { value: 'boolean', label: 'boolean (true·false)' },
  { value: 'json', label: 'json' },
];

const DEFAULT_FIELDS: KeyFields = {
  type: 'string',
  visibility: 'secret',
  required: false,
  optionalIn: [],
  buildTime: false,
  description: '',
};

type Editing = { title: string; key?: string; fields: KeyFields };

/** 키 스키마 탭: 키별 타입·공개 여부·필수·설명, 공개 접두사 (PRD 5.2, 6.3) */
export function KeySchemaPanel({
  project,
  envs,
}: {
  project: string;
  envs: readonly EnvironmentName[];
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const schema = useKeySchema(project);
  const values = useEnvironmentValues(project, envs);
  const [editing, setEditing] = useState<Editing | null>(null);
  const remove = useMutation({
    mutationFn: (key: string) =>
      unwrap(
        api.DELETE('/api/v1/projects/{project}/schema/keys/{key}', {
          params: { path: { project, key } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: schemaKey(project) }),
  });

  if (schema.isPending) return <Spinner />;
  if (schema.isError) return <Flash variant="danger">키 스키마를 불러오지 못했습니다.</Flash>;

  const registered = new Set(schema.data.keys.map((entry) => entry.key));
  const used = new Set(values.flatMap((result) => Object.keys(result.data?.variables ?? {})));
  const unregistered = [...used].filter((key) => !registered.has(key)).sort();

  return (
    <Stack gap="normal">
      <PublicPrefixes project={project} prefixes={schema.data.publicPrefixes} />
      <Stack direction="horizontal" justify="end">
        <Button
          variant="primary"
          leadingVisual={PlusIcon}
          onClick={() => setEditing({ title: '키 추가', fields: DEFAULT_FIELDS })}
        >
          키 추가
        </Button>
      </Stack>
      {remove.isError && (
        <Flash variant="danger">
          {remove.error instanceof SenvApiError ? remove.error.message : '지우지 못했습니다.'}
        </Flash>
      )}
      {schema.data.keys.length === 0 ? (
        <div className={list.box}>
          <p className={list.empty}>
            아직 등록한 키가 없습니다. 키마다 타입과 공개 여부를 등록하면 게시할 때 검사합니다.
          </p>
        </div>
      ) : (
        <div className={table.container}>
          <table className={table.table}>
            <thead>
              <tr>
                <th scope="col">키</th>
                <th scope="col">타입</th>
                <th scope="col">공개 여부</th>
                <th scope="col">필수</th>
                <th scope="col">설명</th>
                <th scope="col" className={table.actions}>
                  관리
                </th>
              </tr>
            </thead>
            <tbody>
              {schema.data.keys.map((entry) => (
                <tr key={entry.key}>
                  <th scope="row" className={table.key}>
                    {entry.key}
                  </th>
                  <td>
                    <Label>{entry.type}</Label>
                  </td>
                  <td>
                    <Label variant={entry.visibility === 'public' ? 'success' : 'secondary'}>
                      {entry.visibility}
                    </Label>
                  </td>
                  <td>
                    <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
                      {entry.required && <Label variant="danger">필수</Label>}
                      {entry.required && entry.optionalIn.length > 0 && (
                        <span className={table.muted}>{entry.optionalIn.join('·')} 제외</span>
                      )}
                      {entry.buildTime && <Label variant="attention">빌드 시점</Label>}
                    </Stack>
                  </td>
                  <td className={table.muted}>{entry.description}</td>
                  <td className={table.actions}>
                    <Stack direction="horizontal" gap="condensed" justify="end">
                      <Button
                        size="small"
                        variant="invisible"
                        leadingVisual={PencilIcon}
                        aria-label={`${entry.key} 편집`}
                        onClick={() =>
                          setEditing({ title: `${entry.key} 편집`, key: entry.key, fields: entry })
                        }
                      >
                        편집
                      </Button>
                      <Button
                        size="small"
                        variant="invisible"
                        leadingVisual={TrashIcon}
                        aria-label={`${entry.key} 삭제`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(entry.key)}
                      >
                        삭제
                      </Button>
                    </Stack>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unregistered.length > 0 && (
        <section className={panel.panel} aria-labelledby="unregistered-title">
          <h3 id="unregistered-title" className={panel.title}>
            스키마에 없는 키
          </h3>
          <ul className={list.box}>
            {unregistered.map((key) => (
              <li key={key} className={list.row}>
                <code className={table.key}>{key}</code>
                <Button
                  size="small"
                  style={{ marginLeft: 'auto' }}
                  aria-label={`${key} 등록`}
                  onClick={() => setEditing({ title: `${key} 등록`, key, fields: DEFAULT_FIELDS })}
                >
                  등록
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {editing && (
        <KeySchemaDialog
          project={project}
          envs={envs}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}

function KeySchemaDialog({
  project,
  envs,
  editing,
  onClose,
}: {
  project: string;
  envs: readonly EnvironmentName[];
  editing: Editing;
  onClose: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [key, setKey] = useState(editing.key ?? '');
  const [fields, setFields] = useState<KeyFields>({
    type: editing.fields.type,
    visibility: editing.fields.visibility,
    required: editing.fields.required,
    optionalIn: editing.fields.optionalIn,
    buildTime: editing.fields.buildTime,
    description: editing.fields.description,
  });
  const update = (patch: Partial<KeyFields>) => setFields((current) => ({ ...current, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT('/api/v1/projects/{project}/schema/keys/{key}', {
          params: { path: { project, key: key.trim() } },
          body: {
            ...fields,
            // 필수가 아니면 예외 환경은 뜻이 없다
            optionalIn: fields.required ? fields.optionalIn : [],
            description: fields.description.trim(),
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: schemaKey(project) });
      onClose();
    },
  });

  return (
    <Dialog title={editing.title} width="medium" onClose={onClose}>
      <Stack gap="normal">
        {save.isError && (
          <Flash variant="danger">
            {save.error instanceof SenvApiError ? save.error.message : '저장하지 못했습니다.'}
          </Flash>
        )}
        {editing.key === undefined && (
          <FormControl>
            <FormControl.Label>키</FormControl.Label>
            <TextInput
              block
              monospace
              placeholder="VITE_API_URL"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </FormControl>
        )}
        <FormControl>
          <FormControl.Label>타입</FormControl.Label>
          <FormControl.Caption>게시할 때 값이 이 형식인지 검사합니다</FormControl.Caption>
          <Select
            block
            value={fields.type}
            onChange={(event) => update({ type: event.target.value as KeyFields['type'] })}
          >
            {TYPES.map((type) => (
              <Select.Option key={type.value} value={type.value}>
                {type.label}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
        <FormControl>
          <FormControl.Label>공개 여부</FormControl.Label>
          <FormControl.Caption>
            public은 클라이언트 번들에 들어가도 되는 값입니다. 매트릭스에서 가리지 않습니다
          </FormControl.Caption>
          <Select
            block
            value={fields.visibility}
            onChange={(event) =>
              update({ visibility: event.target.value as KeyFields['visibility'] })
            }
          >
            <Select.Option value="secret">secret (가림, 번들 금지)</Select.Option>
            <Select.Option value="public">public (번들에 들어가도 됨)</Select.Option>
          </Select>
        </FormControl>
        <FormControl>
          <Checkbox
            checked={fields.required}
            onChange={(event) => update({ required: event.target.checked })}
          />
          <FormControl.Label>모든 환경에 필요</FormControl.Label>
        </FormControl>
        {fields.required && (
          <CheckboxGroup>
            <CheckboxGroup.Label>없어도 되는 환경</CheckboxGroup.Label>
            {envs.map((env) => (
              <FormControl key={env}>
                <Checkbox
                  value={env}
                  checked={fields.optionalIn.includes(env)}
                  onChange={(event) =>
                    update({
                      optionalIn: event.target.checked
                        ? [...fields.optionalIn, env]
                        : fields.optionalIn.filter((other) => other !== env),
                    })
                  }
                />
                <FormControl.Label>{env}</FormControl.Label>
              </FormControl>
            ))}
          </CheckboxGroup>
        )}
        <FormControl>
          <Checkbox
            checked={fields.buildTime}
            onChange={(event) => update({ buildTime: event.target.checked })}
          />
          <FormControl.Label>빌드 시점에 필요</FormControl.Label>
          <FormControl.Caption>
            바뀌면 다시 빌드해야 하는 값 (배포 대상 연동에서 씁니다)
          </FormControl.Caption>
        </FormControl>
        <FormControl>
          <FormControl.Label>설명</FormControl.Label>
          <TextInput
            block
            maxLength={500}
            placeholder="용도, 발급처, 담당자"
            value={fields.description}
            onChange={(event) => update({ description: event.target.value })}
          />
        </FormControl>
        <Stack direction="horizontal" gap="condensed" justify="end">
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            disabled={!key.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            저장
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

/** 클라이언트 번들에 들어가는 키의 접두사. 관리자만 바꾼다 */
function PublicPrefixes({ project, prefixes }: { project: string; prefixes: string[] }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const me = useMe();
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (publicPrefixes: string[]) =>
      unwrap(
        api.PUT('/api/v1/projects/{project}/schema/public-prefixes', {
          params: { path: { project } },
          body: { publicPrefixes },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: schemaKey(project) });
      setDraft(null);
    },
  });

  return (
    <section className={panel.panel} aria-labelledby="public-prefixes-title">
      <Stack gap="condensed">
        <h3 id="public-prefixes-title" className={panel.title}>
          공개 접두사
        </h3>
        <p className={table.muted}>
          이 접두사로 시작하는 키는 클라이언트 번들에 들어갑니다(예: Vite는 VITE_, Expo는
          EXPO_PUBLIC_). 이런 키가 secret이면 senv pull·run이 멈춥니다.
        </p>
        {draft === null ? (
          <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
            {prefixes.length === 0 ? (
              <span className={table.muted}>없음</span>
            ) : (
              prefixes.map((prefix) => (
                <Label key={prefix} variant="accent">
                  {prefix}
                </Label>
              ))
            )}
            {me.data?.role === 'admin' && (
              <Button
                size="small"
                leadingVisual={PencilIcon}
                aria-label="공개 접두사 편집"
                onClick={() => setDraft(prefixes.join(', '))}
              >
                편집
              </Button>
            )}
          </Stack>
        ) : (
          <Stack gap="condensed">
            {save.isError && (
              <Flash variant="danger">
                {save.error instanceof SenvApiError ? save.error.message : '저장하지 못했습니다.'}
              </Flash>
            )}
            <FormControl>
              <FormControl.Label>공개 접두사</FormControl.Label>
              <FormControl.Caption>쉼표로 구분합니다</FormControl.Caption>
              <TextInput
                block
                monospace
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </FormControl>
            <Stack direction="horizontal" gap="condensed">
              <Button
                variant="primary"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate(
                    draft
                      .split(',')
                      .map((prefix) => prefix.trim())
                      .filter(Boolean),
                  )
                }
              >
                접두사 저장
              </Button>
              <Button onClick={() => setDraft(null)}>취소</Button>
            </Stack>
          </Stack>
        )}
      </Stack>
    </section>
  );
}
