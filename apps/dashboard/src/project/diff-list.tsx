import { ArrowRightIcon, EyeIcon } from '@primer/octicons-react';
import { Button, Label } from '@primer/react';
import { diffVariables } from '@senv/core';
import table from '../ui/data-table.module.css';
import list from '../ui/list-box.module.css';
import { useReveal } from '../ui/use-reveal';

type Kind = 'added' | 'changed' | 'removed';

const KIND = {
  added: { text: '추가', variant: 'success' },
  changed: { text: '변경', variant: 'accent' },
  removed: { text: '삭제', variant: 'danger' },
} as const;

/** 두 값 묶음의 차이. 키와 종류를 보여주고 값은 가렸다가 눌러서 30초 동안 본다 (결정 40) */
export function DiffList({
  before,
  after,
}: {
  before: Record<string, string>;
  after: Record<string, string>;
}) {
  const diff = diffVariables(before, after);
  const rows: [Kind, string][] = [
    ...diff.changed.map((key): [Kind, string] => ['changed', key]),
    ...diff.added.map((key): [Kind, string] => ['added', key]),
    ...diff.removed.map((key): [Kind, string] => ['removed', key]),
  ];

  if (rows.length === 0) {
    return (
      <div className={list.box}>
        <p className={list.empty}>바뀐 키가 없습니다.</p>
      </div>
    );
  }
  return (
    <ul className={list.box}>
      {rows.map(([kind, key]) => (
        <DiffRow key={key} kind={kind} name={key} before={before[key]} after={after[key]} />
      ))}
      {diff.unchanged.length > 0 && (
        <li className={list.row}>
          <span className={table.muted}>그대로인 키 {diff.unchanged.length}개</span>
        </li>
      )}
    </ul>
  );
}

function DiffRow({
  kind,
  name,
  before,
  after,
}: {
  kind: Kind;
  name: string;
  before: string | undefined;
  after: string | undefined;
}) {
  const { revealed, reveal } = useReveal();
  const value = (current: string | undefined) => {
    if (current === undefined) return <span className={table.muted}>없음</span>;
    if (revealed) return <code className={table.mono}>{current}</code>;
    return <span className={table.mono}>••••••</span>;
  };

  return (
    <li className={list.row}>
      <Label variant={KIND[kind].variant}>{KIND[kind].text}</Label>
      <code className={table.key}>{name}</code>
      {value(before)}
      <ArrowRightIcon className={list.icon} />
      {value(after)}
      {!revealed && (
        <Button
          size="small"
          variant="invisible"
          leadingVisual={EyeIcon}
          aria-label={`${name} 값 보기`}
          onClick={reveal}
        >
          보기
        </Button>
      )}
    </li>
  );
}
