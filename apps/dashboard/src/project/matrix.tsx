import { EyeIcon } from '@primer/octicons-react';
import { Button, CounterLabel, Label, Stack } from '@primer/react';
import table from '../ui/data-table.module.css';
import { useReveal } from '../ui/use-reveal';
import type { EnvironmentName, EnvironmentValues, KeySchema } from './queries';

/** 환경 이름 뒤에 붙는 조사 (로컬→과, 디벨롭먼트→와, 프로덕션→과) */
const WITH: Record<EnvironmentName, string> = { local: '과', development: '와', production: '과' };

export interface MatrixProps {
  envs: readonly EnvironmentName[];
  values: Partial<Record<EnvironmentName, EnvironmentValues>>;
  /** 키 스키마. public 값은 가리지 않고, 필수 키의 누락은 강조한다 */
  schema?: KeySchema[];
  /** local 열에 붙이는 내 PC 반영 상태 (로컬 자동 받기, M1.1) */
  localNote?: string;
}

/** 행은 키, 열은 환경. 값은 가리고, 누락과 다른 환경과 같은 값을 표시한다 (PRD 7.1) */
export function Matrix({ envs, values, schema = [], localNote }: MatrixProps) {
  const schemaByKey = new Map(schema.map((entry) => [entry.key, entry]));
  // 어느 환경에도 값이 없는 필수 키도 행으로 보여 누락을 드러낸다
  const keys = [
    ...new Set([
      ...envs.flatMap((env) => Object.keys(values[env]?.variables ?? {})),
      ...schema.filter((entry) => entry.required).map((entry) => entry.key),
    ]),
  ].sort();

  return (
    <div className={table.container}>
      <table className={table.table}>
        <thead>
          <tr>
            <th scope="col">키</th>
            {envs.map((env) => {
              const version = values[env]?.version ?? 0;
              return (
                <th key={env} scope="col">
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <span>{env}</span>
                    {version === 0 ? (
                      <Label variant="secondary">게시 전</Label>
                    ) : (
                      <CounterLabel>{`v${version}`}</CounterLabel>
                    )}
                    {env === 'local' && localNote && (
                      <span className={table.muted}>{localNote}</span>
                    )}
                  </Stack>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <th scope="row" className={table.key}>
                <Stack direction="horizontal" gap="condensed" align="center">
                  <span>{key}</span>
                  {schemaByKey.get(key)?.visibility === 'public' && (
                    <Label variant="success">public</Label>
                  )}
                </Stack>
              </th>
              {envs.map((env) => (
                <td key={env}>
                  <MatrixCell
                    name={`${key} ${env}`}
                    value={values[env]?.variables[key]}
                    visible={schemaByKey.get(key)?.visibility === 'public'}
                    required={isRequiredIn(schemaByKey.get(key), env)}
                    sameAs={envs.filter(
                      (other) =>
                        other !== env &&
                        values[other]?.variables[key] !== undefined &&
                        values[other]?.variables[key] === values[env]?.variables[key],
                    )}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const isRequiredIn = (entry: KeySchema | undefined, env: EnvironmentName) =>
  entry?.required === true && !entry.optionalIn.includes(env);

function MatrixCell({
  name,
  value,
  visible,
  required,
  sameAs,
}: {
  name: string;
  value: string | undefined;
  /** public 값은 가리지 않는다 */
  visible: boolean;
  /** 필수 키면 누락을 오류로 보여준다 */
  required: boolean;
  sameAs: EnvironmentName[];
}) {
  const { revealed: clicked, reveal } = useReveal();
  const revealed = visible || clicked;

  if (value === undefined) {
    return (
      <Label variant={required ? 'danger' : 'attention'} title={required ? '필수 키' : undefined}>
        누락
      </Label>
    );
  }
  const last = sameAs.at(-1);
  return (
    <Stack gap="none">
      <Stack direction="horizontal" gap="condensed" align="center">
        {revealed ? (
          <code className={table.mono}>{value}</code>
        ) : (
          <>
            <span className={table.mono}>••••••</span>
            <Button
              size="small"
              variant="invisible"
              leadingVisual={EyeIcon}
              aria-label={`${name} 값 보기`}
              onClick={reveal}
            >
              보기
            </Button>
          </>
        )}
      </Stack>
      {last && <span className={table.muted}>{`${sameAs.join('·')}${WITH[last]} 같음`}</span>}
    </Stack>
  );
}
