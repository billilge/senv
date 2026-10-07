import { Button, Spinner, Stack, Text } from '@primer/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useApi } from '../api-context';
import { useMe } from '../auth/use-me';
import { PendingPage } from '../pages/pending-page';

/** 로그인이 필요한 영역. 로그인하지 않았으면 /login으로, 승인 대기면 안내만 보여준다 */
export function AppLayout() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <Spinner />;
  if (me.isError) return <Text>사용자 정보를 불러오지 못했습니다.</Text>;
  if (!me.data) {
    // 이동하는 동안 이 레이아웃이 잠깐 남아 있으면 /login 주소를 다시 next에 담아 끝없이 이동하게 된다
    if (location.pathname === '/login') return null;
    return <Navigate to="/login" search={{ next: location.href }} replace />;
  }

  return (
    <Stack>
      <TopBar login={me.data.login} isAdmin={me.data.role === 'admin'} />
      <Stack padding="normal">{me.data.status === 'active' ? <Outlet /> : <PendingPage />}</Stack>
    </Stack>
  );
}

function TopBar({ login, isAdmin }: { login: string; isAdmin: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const logout = async () => {
    await api.POST('/api/v1/auth/logout');
    queryClient.clear();
    await navigate({ to: '/login' });
  };

  return (
    <Stack direction="horizontal" align="center" justify="space-between" padding="normal">
      <Stack direction="horizontal" align="center">
        <Link to="/">Stream Env Control</Link>
        {isAdmin && <Link to="/admin/users">사용자 관리</Link>}
      </Stack>
      <Stack direction="horizontal" align="center">
        <Text>{login}</Text>
        <Button onClick={logout}>로그아웃</Button>
      </Stack>
    </Stack>
  );
}
