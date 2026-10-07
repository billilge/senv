import { BaseStyles, ThemeProvider } from '@primer/react';
import { SenvApiError, type SenvClient } from '@senv/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RouterHistory, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiProvider } from './api-context';
import { createAppRouter } from './router';

export interface AppProps {
  client: SenvClient;
  history?: RouterHistory;
}

export function App({ client, history }: AppProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 4xx(권한, 없음 등)는 다시 해도 같으므로 재시도하지 않는다
            retry: (failureCount, error) =>
              !(error instanceof SenvApiError && error.status < 500) && failureCount < 2,
          },
        },
      }),
  );
  const [router] = useState(() => createAppRouter(history));

  return (
    <ThemeProvider colorMode="auto">
      <BaseStyles>
        <QueryClientProvider client={queryClient}>
          <ApiProvider client={client}>
            <RouterProvider router={router} />
          </ApiProvider>
        </QueryClientProvider>
      </BaseStyles>
    </ThemeProvider>
  );
}
