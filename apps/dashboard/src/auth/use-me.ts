import { type ApiSchemas, SenvApiError, unwrap } from '@senv/api-client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api-context';

export type User = ApiSchemas['User'];

export const ME_QUERY_KEY = ['me'] as const;

/** 로그인한 사용자. 로그인하지 않았으면 null */
export function useMe() {
  const api = useApi();
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async (): Promise<User | null> => {
      try {
        return await unwrap(api.GET('/api/v1/me'));
      } catch (error) {
        if (error instanceof SenvApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}
