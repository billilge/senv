/** 닫는 따옴표의 위치. 큰따옴표 안의 `\"`는 건너뛴다. 없으면 -1 */
export function findClosingQuote(text: string, quote: '"' | "'"): number {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote === '"' && char === '\\') {
      i++; // 이스케이프된 다음 글자는 닫는 따옴표가 아니다
      continue;
    }
    if (char === quote) return i;
  }
  return -1;
}
