import { useEffect, useState } from 'react';

/** 가린 값을 눌러서 볼 때 보여주는 시간 (결정 31) */
export const REVEAL_MS = 30_000;

/** 값 보기 상태. reveal()을 부르면 30초 뒤 다시 가린다 */
export function useReveal() {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [revealed]);
  return { revealed, reveal: () => setRevealed(true) };
}
