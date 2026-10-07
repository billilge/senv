import { KeyIcon } from '@primer/octicons-react';
import { ActionList, ActionMenu, Avatar, Spinner, Text } from '@primer/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useApi } from '../api-context';
import { type User, useMe } from '../auth/use-me';
import { PendingPage } from '../pages/pending-page';
import classes from './app-layout.module.css';

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

  const active = me.data.status === 'active';
  return (
    <>
      <TopBar me={me.data} showNav={active} />
      <main className={classes.main}>{active ? <Outlet /> : <PendingPage />}</main>
    </>
  );
}

/** GitHub처럼 어두운 상단 헤더: 앱 이름, 메뉴, 사용자 메뉴(로그아웃) */
function TopBar({ me, showNav }: { me: User; showNav: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const logout = async () => {
    await api.POST('/api/v1/auth/logout');
    queryClient.clear();
    await navigate({ to: '/login' });
  };

  return (
    <header className={classes.header}>
      <Link to="/" className={classes.brand}>
        <KeyIcon size={20} />
        Stream Env Control
      </Link>
      <nav className={classes.nav} aria-label="주 메뉴">
        {showNav && (
          <Link
            to="/"
            className={classes.navLink}
            data-selected={pathname === '/' || pathname.startsWith('/projects')}
          >
            프로젝트
          </Link>
        )}
        {showNav && me.role === 'admin' && (
          <Link
            to="/admin/users"
            className={classes.navLink}
            data-selected={pathname.startsWith('/admin')}
          >
            사용자 관리
          </Link>
        )}
      </nav>
      <ActionMenu>
        <ActionMenu.Button
          variant="invisible"
          leadingVisual={
            me.avatarUrl ? () => <Avatar src={me.avatarUrl ?? ''} alt="" /> : undefined
          }
        >
          {me.login}
        </ActionMenu.Button>
        <ActionMenu.Overlay align="end">
          <ActionList>
            <ActionList.Group>
              <ActionList.GroupHeading>
                <Text>{me.name ?? me.login}</Text>
              </ActionList.GroupHeading>
              <ActionList.Item variant="danger" onSelect={logout}>
                로그아웃
              </ActionList.Item>
            </ActionList.Group>
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
    </header>
  );
}
