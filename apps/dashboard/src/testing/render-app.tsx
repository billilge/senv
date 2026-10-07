import { createSenvClient } from '@senv/api-client';
import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../app';
import type { FakeApi } from './fake-api';

/** 가짜 서버와 메모리 라우터로 앱 전체를 그린다 */
export function renderApp(path: string, api: FakeApi) {
  const client = createSenvClient({ baseUrl: 'http://localhost:3000', fetch: api.fetch });
  const history = createMemoryHistory({ initialEntries: [path] });
  const user = userEvent.setup();
  const view = render(<App client={client} history={history} />);
  return { ...view, history, user };
}
