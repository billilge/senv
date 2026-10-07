import { unwrap } from '@senv/api-client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api-context';

export const USERS_QUERY_KEY = ['users'] as const;

/** 사용자 목록 (관리자만). 사용자 관리 화면과 헤더의 승인 대기 배지가 같이 쓴다 */
export function useUsers(options: { enabled?: boolean } = {}) {
  const api = useApi();
  return useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: () => unwrap(api.GET('/api/v1/users')),
    enabled: options.enabled ?? true,
  });
}
