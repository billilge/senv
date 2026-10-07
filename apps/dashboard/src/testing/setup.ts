import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom에 없는 브라우저 API (Primer 컴포넌트가 쓴다)
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
// Primer Tooltip이 쓰는 popover 폴리필이 문서의 adoptedStyleSheets에 스타일을 넣는다
if (!('adoptedStyleSheets' in Document.prototype)) {
  const sheets = new WeakMap<Document, CSSStyleSheet[]>();
  Object.defineProperty(Document.prototype, 'adoptedStyleSheets', {
    configurable: true,
    get(this: Document) {
      return sheets.get(this) ?? [];
    },
    set(this: Document, value: CSSStyleSheet[]) {
      sheets.set(this, value);
    },
  });
}
