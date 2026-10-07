import { Avatar, Button, Flash, Heading, Label, Spinner, Stack, Text } from '@primer/react';
import { SenvApiError, unwrap } from '@senv/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api-context';
import { ME_QUERY_KEY, type User, useMe } from '../auth/use-me';
import { USERS_QUERY_KEY, useUsers } from '../users/queries';

const STATUS = {
  pending: { text: '승인 대기', variant: 'attention' },
  active: { text: '활성', variant: 'success' },
  disabled: { text: '비활성', variant: 'secondary' },
} as const;

const ROLE = {
  admin: { text: '관리자', variant: 'accent' },
  member: { text: '멤버', variant: 'default' },
} as const;

type UserAction =
  | { kind: 'activate'; user: User }
  | { kind: 'disable'; user: User }
  | { kind: 'role'; user: User; role: User['role'] };

/** 관리자의 사용자 관리: 승인, 비활성화, 역할 변경 (PRD 7.1) */
export function UsersPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const me = useMe();
  const users = useUsers();
  const act = useMutation({
    mutationFn: (action: UserAction) => {
      const params = { path: { id: action.user.id } };
      switch (action.kind) {
        case 'activate':
          return unwrap(api.POST('/api/v1/users/{id}/activate', { params }));
        case 'disable':
          return unwrap(api.POST('/api/v1/users/{id}/disable', { params }));
        case 'role':
          return unwrap(
            api.PUT('/api/v1/users/{id}/role', { params, body: { role: action.role } }),
          );
      }
    },
    onSuccess: async (_, action) => {
      await queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      // 자기 역할을 바꿨으면 화면 권한도 다시 받는다
      if (action.user.id === me.data?.id) {
        await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      }
    },
  });

  if (users.isPending) return <Spinner />;
  if (users.isError) {
    return (
      <Flash variant="danger">
        {users.error instanceof SenvApiError
          ? users.error.message
          : '사용자 목록을 불러오지 못했습니다.'}
      </Flash>
    );
  }

  const pendingCount = users.data.users.filter((user) => user.status === 'pending').length;

  return (
    <Stack>
      <Heading as="h2">사용자 관리</Heading>
      {pendingCount > 0 && (
        <Flash variant="warning">
          승인 대기 {pendingCount}명. 승인해야 값을 보고 내려받을 수 있습니다.
        </Flash>
      )}
      {act.isError && (
        <Flash variant="danger">
          {act.error instanceof SenvApiError ? act.error.message : '처리하지 못했습니다.'}
        </Flash>
      )}
      <table>
        <thead>
          <tr>
            <th scope="col">사용자</th>
            <th scope="col">상태</th>
            <th scope="col">역할</th>
            <th scope="col">관리</th>
          </tr>
        </thead>
        <tbody>
          {users.data.users.map((user) => (
            <tr key={user.id}>
              <th scope="row">
                <Stack direction="horizontal" gap="condensed" align="center">
                  {user.avatarUrl && <Avatar src={user.avatarUrl} alt="" />}
                  <Text weight="semibold">{user.login}</Text>
                  {user.name && <Text>{user.name}</Text>}
                  {user.id === me.data?.id && <Label>나</Label>}
                </Stack>
              </th>
              <td>
                <Label variant={STATUS[user.status].variant}>{STATUS[user.status].text}</Label>
              </td>
              <td>
                <Label variant={ROLE[user.role].variant}>{ROLE[user.role].text}</Label>
              </td>
              <td>
                <UserActions
                  user={user}
                  disabled={act.isPending}
                  onAct={(action) => act.mutate(action)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Stack>
  );
}

function UserActions({
  user,
  disabled,
  onAct,
}: {
  user: User;
  disabled: boolean;
  onAct: (action: UserAction) => void;
}) {
  const button = (label: string, action: UserAction, variant?: 'primary' | 'danger') => (
    <Button
      size="small"
      variant={variant}
      aria-label={`${user.login} ${label}`}
      disabled={disabled}
      onClick={() => onAct(action)}
    >
      {label}
    </Button>
  );

  return (
    <Stack direction="horizontal" gap="condensed" wrap="wrap">
      {user.status === 'pending' && button('승인', { kind: 'activate', user }, 'primary')}
      {user.status === 'active' && button('비활성화', { kind: 'disable', user }, 'danger')}
      {user.status === 'disabled' && button('다시 활성화', { kind: 'activate', user })}
      {user.status === 'active' &&
        (user.role === 'member'
          ? button('관리자로 지정', { kind: 'role', user, role: 'admin' })
          : button('멤버로 변경', { kind: 'role', user, role: 'member' }))}
    </Stack>
  );
}
