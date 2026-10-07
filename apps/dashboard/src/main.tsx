// 다크 모드만 지원한다 (GitHub 다크 테마)
import '@primer/primitives/dist/css/functional/themes/dark.css';
import './global.css';
import { createSenvClient, type SenvClient } from '@senv/api-client';
import { type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';

async function start() {
  let client: SenvClient;
  let toolbar: ReactNode = null;
  if (import.meta.env.MODE === 'mock') {
    // `pnpm dev:mock`: 서버 없이 브라우저 안의 가짜 API로 화면을 본다. 프로덕션 빌드에서는 이 분기가 빠진다
    ({ client, toolbar } = (await import('./mock/start-mock')).startMock());
  } else {
    // 대시보드는 API와 같은 출처에서 서빙된다 (개발 중에는 Vite 프록시)
    client = createSenvClient({ baseUrl: window.location.origin });
  }

  const root = document.getElementById('root');
  if (root) {
    createRoot(root).render(
      <StrictMode>
        <App client={client} />
        {toolbar}
      </StrictMode>,
    );
  }
}

void start();
