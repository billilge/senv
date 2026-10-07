import type { SenvClient } from '@senv/api-client';
import { createContext, type ReactNode, useContext } from 'react';

const ApiContext = createContext<SenvClient | null>(null);

export function ApiProvider({ client, children }: { client: SenvClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

/** 서버 API 클라이언트. 대시보드는 같은 출처라 세션 쿠키가 자동으로 붙는다 */
export function useApi(): SenvClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('ApiProvider 안에서만 쓸 수 있습니다');
  return client;
}
