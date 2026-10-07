import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { AppLayout } from './layout/app-layout';
import { LoginPage } from './pages/login-page';
import { DevicePage, ProjectPage, ProjectsPage, UsersPage } from './pages/placeholders';

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { next?: string; error?: string } => ({
    next: typeof search.next === 'string' ? search.next : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: function Login() {
    const { next, error } = loginRoute.useSearch();
    return <LoginPage next={next} error={error} />;
  },
});

/** 로그인이 필요한 화면들의 부모 */
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: AppLayout });

const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: ProjectsPage,
});
const projectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$project',
  component: ProjectPage,
});
const deviceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/device',
  component: DevicePage,
});
const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/users',
  component: UsersPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([projectsRoute, projectRoute, deviceRoute, usersRoute]),
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
