import { type EnvironmentName, isEnvironmentName } from '@senv/core';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { AppLayout } from './layout/app-layout';
import { DevicePage } from './pages/device-page';
import { LocalLinksPage } from './pages/local-links-page';
import { LoginPage } from './pages/login-page';
import { ProjectPage } from './pages/project-page';
import { ProjectsPage } from './pages/projects-page';
import { TargetsPage } from './pages/targets-page';
import { UsersPage } from './pages/users-page';

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
  component: function Project() {
    const { project } = projectRoute.useParams();
    return <ProjectPage project={project} />;
  },
});
const projectHistoryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$project/history',
  validateSearch: (search: Record<string, unknown>): { env?: EnvironmentName } => ({
    env: typeof search.env === 'string' && isEnvironmentName(search.env) ? search.env : undefined,
  }),
  component: function ProjectHistory() {
    const { project } = projectHistoryRoute.useParams();
    const { env } = projectHistoryRoute.useSearch();
    return <ProjectPage project={project} tab="history" env={env} />;
  },
});
const projectSchemaRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$project/schema',
  component: function ProjectSchema() {
    const { project } = projectSchemaRoute.useParams();
    return <ProjectPage project={project} tab="schema" />;
  },
});
const projectTargetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$project/targets',
  component: function ProjectTargetsTab() {
    const { project } = projectTargetsRoute.useParams();
    return <ProjectPage project={project} tab="targets" />;
  },
});
const targetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/targets',
  component: TargetsPage,
});
const deviceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/device',
  validateSearch: (search: Record<string, unknown>): { code?: string } => ({
    code: typeof search.code === 'string' ? search.code : undefined,
  }),
  component: function Device() {
    const { code } = deviceRoute.useSearch();
    return <DevicePage code={code} />;
  },
});
const localLinksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/me/local',
  component: LocalLinksPage,
});
const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/users',
  component: UsersPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    projectsRoute,
    projectRoute,
    projectHistoryRoute,
    projectSchemaRoute,
    projectTargetsRoute,
    targetsRoute,
    deviceRoute,
    usersRoute,
    localLinksRoute,
  ]),
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
