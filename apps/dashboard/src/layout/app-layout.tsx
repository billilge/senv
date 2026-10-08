import { KeyIcon, PeopleIcon, RepoIcon, ServerIcon } from '@primer/octicons-react';
import { ActionList, ActionMenu, Avatar, Spinner, Text, UnderlineNav } from '@primer/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useApi } from '../api-context';
import { type User, useMe } from '../auth/use-me';
import { PendingPage } from '../pages/pending-page';
import { useProjects } from '../project/queries';
import { useUsers } from '../users/queries';
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

/** GitHub 저장소 화면처럼: 위 줄은 앱 이름과 사용자 메뉴, 아래 줄은 아이콘·개수가 붙은 탭 */
function TopBar({ me, showNav }: { me: User; showNav: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isAdmin = me.role === 'admin';
  const projects = useProjects();
  const users = useUsers({ enabled: showNav && isAdmin });
  const pendingCount = users.data?.users.filter((user) => user.status === 'pending').length ?? 0;

  const logout = async () => {
    await api.POST('/api/v1/auth/logout');
    queryClient.clear();
    await navigate({ to: '/login' });
  };

  return (
    <header className={classes.header}>
      <div className={classes.top}>
        <Link to="/" className={classes.brand}>
          <KeyIcon size={24} />
          Stream Env Control
        </Link>
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
                <ActionList.Item onSelect={() => navigate({ to: '/me/local' })}>
                  내 로컬 연결
                </ActionList.Item>
                <ActionList.Item variant="danger" onSelect={logout}>
                  로그아웃
                </ActionList.Item>
              </ActionList.Group>
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      </div>
      {showNav && (
        <UnderlineNav aria-label="주 메뉴" className={classes.tabs}>
          <UnderlineNav.Item
            as={Link}
            to="/"
            icon={RepoIcon}
            counter={projects.data?.projects.length}
            aria-current={pathname === '/' || pathname.startsWith('/projects') ? 'page' : undefined}
          >
            프로젝트
          </UnderlineNav.Item>
          {isAdmin && (
            <UnderlineNav.Item
              as={Link}
              to="/admin/users"
              icon={PeopleIcon}
              counter={pendingCount > 0 ? pendingCount : undefined}
              aria-current={pathname.startsWith('/admin/users') ? 'page' : undefined}
            >
              사용자 관리
            </UnderlineNav.Item>
          )}
          {isAdmin && (
            <UnderlineNav.Item
              as={Link}
              to="/admin/targets"
              icon={ServerIcon}
              aria-current={pathname.startsWith('/admin/targets') ? 'page' : undefined}
            >
              배포 대상
            </UnderlineNav.Item>
          )}
        </UnderlineNav>
      )}
    </header>
  );
}
