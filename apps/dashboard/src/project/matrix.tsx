import { Button, Label, Text } from '@primer/react';
import { useEffect, useState } from 'react';
import type { EnvironmentName, EnvironmentValues } from './queries';

const REVEAL_MS = 30_000;
/** 환경 이름 뒤에 붙는 조사 (로컬→과, 디벨롭먼트→와, 프로덕션→과) */
const WITH: Record<EnvironmentName, string> = { local: '과', development: '와', production: '과' };

export interface MatrixProps {
  envs: readonly EnvironmentName[];
  values: Partial<Record<EnvironmentName, EnvironmentValues>>;
}

/** 행은 키, 열은 환경. 값은 가리고, 누락과 다른 환경과 같은 값을 표시한다 (PRD 7.1) */
export function Matrix({ envs, values }: MatrixProps) {
  const keys = [
    ...new Set(envs.flatMap((env) => Object.keys(values[env]?.variables ?? {}))),
  ].sort();

  return (
    <table>
      <thead>
        <tr>
          <th scope="col">키</th>
          {envs.map((env) => {
            const version = values[env]?.version ?? 0;
            return (
              <th key={env} scope="col">
                {env} <Text>{version === 0 ? '게시 전' : `v${version}`}</Text>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key}>
            <th scope="row">{key}</th>
            {envs.map((env) => (
              <td key={env}>
                <MatrixCell
                  name={`${key} ${env}`}
                  value={values[env]?.variables[key]}
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
  );
}

function MatrixCell({
  name,
  value,
  sameAs,
}: {
  name: string;
  value: string | undefined;
  sameAs: EnvironmentName[];
}) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  if (value === undefined) return <Label variant="attention">누락</Label>;
  const last = sameAs.at(-1);
  return (
    <span>
      {revealed ? <code>{value}</code> : <Text>••••••</Text>}{' '}
      {!revealed && (
        <Button
          size="small"
          variant="invisible"
          aria-label={`${name} 값 보기`}
          onClick={() => setRevealed(true)}
        >
          보기
        </Button>
      )}
      {last && <Text>{`${sameAs.join('·')}${WITH[last]} 같음`}</Text>}
    </span>
  );
}
