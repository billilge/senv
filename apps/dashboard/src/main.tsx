import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/dark.css';
import { createSenvClient } from '@senv/api-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';

// 대시보드는 API와 같은 출처에서 서빙된다 (개발 중에는 Vite 프록시)
const client = createSenvClient({ baseUrl: window.location.origin });

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App client={client} />
    </StrictMode>,
  );
}
