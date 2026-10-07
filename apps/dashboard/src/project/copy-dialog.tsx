import {
  Button,
  Checkbox,
  CheckboxGroup,
  Dialog,
  Flash,
  FormControl,
  Select,
  Stack,
} from '@primer/react';
import type { EnvironmentName } from '@senv/core';
import { useState } from 'react';
import table from '../ui/data-table.module.css';
import { DiffList } from './diff-list';
import type { EnvironmentValues } from './queries';

const pick = (variables: Record<string, string>, keys: string[]) =>
  Object.fromEntries(
    keys.filter((key) => Object.hasOwn(variables, key)).map((key) => [key, variables[key] ?? '']),
  );

/**
 * 환경 간 복사 (PRD 7.2, 결정 47): 고른 키의 값을 다른 환경의 편집 화면에 담는다.
 * 게시는 그 환경의 편집 화면에서 변경을 확인한 뒤에 한다.
 */
export function CopyDialog({
  envs,
  values,
  onApply,
  onClose,
}: {
  envs: readonly EnvironmentName[];
  values: Partial<Record<EnvironmentName, EnvironmentValues>>;
  onApply: (target: EnvironmentName, changes: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<EnvironmentName>(envs[0] ?? 'local');
  const [target, setTarget] = useState<EnvironmentName>(envs[1] ?? 'development');
  const [keys, setKeys] = useState<string[]>([]);
  const sourceVariables = values[source]?.variables ?? {};
  const targetVariables = values[target]?.variables ?? {};
  const sourceKeys = Object.keys(sourceVariables).sort();
  const selected = keys.filter((key) => sourceKeys.includes(key));
  const sameEnv = source === target;

  const envSelect = (
    label: string,
    value: EnvironmentName,
    onChange: (env: EnvironmentName) => void,
  ) => (
    <FormControl>
      <FormControl.Label>{label}</FormControl.Label>
      <Select value={value} onChange={(event) => onChange(event.target.value as EnvironmentName)}>
        {envs.map((env) => (
          <Select.Option key={env} value={env}>
            {env}
          </Select.Option>
        ))}
      </Select>
    </FormControl>
  );

  return (
    <Dialog title="환경 간 복사" width="large" onClose={onClose}>
      <Stack gap="normal">
        <Stack direction="horizontal" gap="normal" wrap="wrap">
          {envSelect('원본 환경', source, (env) => {
            setSource(env);
            setKeys([]);
          })}
          {envSelect('대상 환경', target, setTarget)}
        </Stack>
        {sameEnv && <Flash variant="warning">원본과 다른 환경을 고르세요.</Flash>}
        {sourceKeys.length === 0 ? (
          <p className={table.muted}>{source}에는 아직 값이 없습니다.</p>
        ) : (
          <CheckboxGroup>
            <CheckboxGroup.Label>복사할 키</CheckboxGroup.Label>
            {sourceKeys.map((key) => (
              <FormControl key={key}>
                <Checkbox
                  value={key}
                  checked={selected.includes(key)}
                  onChange={(event) =>
                    setKeys((current) =>
                      event.target.checked
                        ? [...current, key]
                        : current.filter((other) => other !== key),
                    )
                  }
                />
                <FormControl.Label>{key}</FormControl.Label>
              </FormControl>
            ))}
          </CheckboxGroup>
        )}
        {selected.length > 0 && !sameEnv && (
          <Stack gap="condensed">
            <span className={table.muted}>{target}에서 바뀌는 값</span>
            <DiffList
              before={pick(targetVariables, selected)}
              after={pick(sourceVariables, selected)}
            />
          </Stack>
        )}
        <Stack direction="horizontal" gap="condensed" justify="end">
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            disabled={sameEnv || selected.length === 0}
            onClick={() => onApply(target, pick(sourceVariables, selected))}
          >
            편집에 담기
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
