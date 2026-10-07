import { Flash, Heading, Link, Spinner, Stack, Text } from '@primer/react';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useMe } from '../auth/use-me';

/** 서버가 /login?error=<code>로 알려주는 로그인 실패 (PRD 결정 기록, web-auth.controller) */
const LOGIN_ERRORS: Record<string, string> = {
  not_org_member:
    '허용된 GitHub 조직의 멤버만 로그인할 수 있습니다. 조직 초대를 수락했는지 확인하세요.',
  user_disabled: '비활성화된 사용자입니다. 관리자에게 문의하세요.',
  invalid_state: '로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도하세요.',
  github_auth_failed: 'GitHub 인증에 실패했습니다. 다시 시도하세요.',
  github_unavailable: 'GitHub에 연결할 수 없습니다. 잠시 후 다시 시도하세요.',
};

export function LoginPage({ next, error }: { next?: string; error?: string }) {
  const me = useMe();
  const target = safePath(next) ?? '/';

  if (me.isPending) return <Spinner />;
  if (me.data) return <RedirectTo href={target} />;

  return (
    <Stack align="center" padding="spacious">
      <Heading as="h1">Stream Env Control</Heading>
      <Text>Stream 서비스의 환경변수를 한곳에서 관리합니다.</Text>
      {error && (
        <Flash variant="danger">
          {LOGIN_ERRORS[error] ?? '로그인하지 못했습니다. 다시 시도하세요.'}
        </Flash>
      )}
      <Link href={`/auth/github?next=${encodeURIComponent(target)}`}>GitHub로 로그인</Link>
    </Stack>
  );
}

/** 쿼리가 붙은 주소로 이동한다 (라우트 경로만 받는 Navigate 대신) */
function RedirectTo({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.history.replace(href);
  }, [router, href]);
  return null;
}

/** 같은 사이트 안의 경로만 돌아갈 곳으로 받는다 (서버와 같은 규칙) */
function safePath(value?: string): string | undefined {
  if (!value?.startsWith('/') || value.startsWith('//') || value.startsWith('/\\'))
    return undefined;
  return value;
}
