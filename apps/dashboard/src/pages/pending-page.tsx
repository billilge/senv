import { ClockIcon } from '@primer/octicons-react';
import card from '../ui/card.module.css';

export function PendingPage() {
  return (
    <div className={card.page}>
      <div className={card.card}>
        <ClockIcon size={48} className={card.logo} />
        <h2 className={card.title}>승인 대기 중</h2>
        <div className={card.box}>
          <p className={card.note}>
            관리자의 승인을 기다리는 중입니다. 승인되면 이 화면을 새로고침하세요.
          </p>
        </div>
      </div>
    </div>
  );
}
