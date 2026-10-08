import { CheckIcon, CopyIcon } from '@primer/octicons-react';
import { IconButton } from '@primer/react';
import { type ReactNode, useEffect, useState } from 'react';
import styles from './guide.module.css';

/** 본문 속 짧은 코드 */
export function C({ children }: { children: ReactNode }) {
  return <code className={styles.inline}>{children}</code>;
}

/** 복사 버튼이 붙은 명령·설정 블록. label은 버튼 이름("<label> 복사")이 된다 */
export function Command({ label, children }: { label: string; children: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className={styles.command}>
      <pre>
        <code>{children}</code>
      </pre>
      <IconButton
        className={styles.copy}
        size="small"
        variant="invisible"
        icon={copied ? CheckIcon : CopyIcon}
        aria-label={copied ? '복사했습니다' : `${label} 복사`}
        onClick={async () => {
          await navigator.clipboard.writeText(children);
          setCopied(true);
        }}
      />
    </div>
  );
}
