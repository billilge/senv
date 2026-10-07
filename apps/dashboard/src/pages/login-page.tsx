import { Heading, Link, Stack, Text } from '@primer/react';

export function LoginPage({ next }: { next?: string }) {
  const href = `/auth/github?next=${encodeURIComponent(next ?? '/')}`;
  return (
    <Stack align="center" padding="spacious">
      <Heading as="h1">Stream Env Control</Heading>
      <Text>Stream 서비스의 환경변수를 한곳에서 관리합니다.</Text>
      <Link href={href}>GitHub로 로그인</Link>
    </Stack>
  );
}
