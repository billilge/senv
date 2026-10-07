import { PersonAddIcon, XIcon } from '@primer/octicons-react';
import { Button, Flash, FormControl, Label, Select, Stack, TextInput } from '@primer/react';
import { SenvApiError, unwrap } from '@senv/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useApi } from '../api-context';
import table from '../ui/data-table.module.css';
import list from '../ui/list-box.module.css';
import panel from '../ui/panel.module.css';

const ASSIGNMENTS_KEY = ['role-assignments'] as const;

/** 아직 로그인하지 않은 GitHub 사용자의 역할을 미리 정한다 (결정 45) */
export function RoleAssignments() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [login, setLogin] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const assignments = useQuery({
    queryKey: ASSIGNMENTS_KEY,
    queryFn: () => unwrap(api.GET('/api/v1/role-assignments')),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ASSIGNMENTS_KEY });
  const assign = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT('/api/v1/role-assignments/{login}', {
          params: { path: { login: login.trim() } },
          body: { role },
        }),
      ),
    onSuccess: async () => {
      setLogin('');
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (target: string) =>
      unwrap(
        api.DELETE('/api/v1/role-assignments/{login}', { params: { path: { login: target } } }),
      ),
    onSuccess: refresh,
  });
  const error = assign.error ?? remove.error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    assign.mutate();
  };

  return (
    <section className={panel.panel} aria-labelledby="role-assignments-title">
      <Stack gap="normal">
        <h3 id="role-assignments-title" className={panel.title}>
          역할 미리 지정
        </h3>
        <p className={table.muted}>
          아직 로그인하지 않은 GitHub 사용자명에 역할을 정해 두면, 처음 로그인할 때 승인 대기 없이
          바로 그 역할로 쓸 수 있습니다.
        </p>
        {error && (
          <Flash variant="danger">
            {error instanceof SenvApiError ? error.message : '처리하지 못했습니다.'}
          </Flash>
        )}
        <form onSubmit={submit}>
          <Stack direction="horizontal" gap="condensed" align="end" wrap="wrap">
            <FormControl>
              <FormControl.Label>GitHub 사용자명</FormControl.Label>
              <TextInput
                monospace
                placeholder="octocat"
                value={login}
                onChange={(event) => setLogin(event.target.value)}
              />
            </FormControl>
            <FormControl>
              <FormControl.Label>역할</FormControl.Label>
              <Select
                value={role}
                onChange={(event) => setRole(event.target.value as 'member' | 'admin')}
              >
                <Select.Option value="member">멤버</Select.Option>
                <Select.Option value="admin">관리자</Select.Option>
              </Select>
            </FormControl>
            <Button
              type="submit"
              leadingVisual={PersonAddIcon}
              disabled={!login.trim() || assign.isPending}
            >
              지정
            </Button>
          </Stack>
        </form>
        {assignments.data && assignments.data.assignments.length > 0 && (
          <ul className={list.box}>
            {assignments.data.assignments.map((assignment) => (
              <li key={assignment.login} className={list.row}>
                <code className={table.key}>{assignment.login}</code>
                <Label variant={assignment.role === 'admin' ? 'accent' : 'default'}>
                  {assignment.role === 'admin' ? '관리자' : '멤버'}
                </Label>
                <Button
                  size="small"
                  variant="invisible"
                  leadingVisual={XIcon}
                  style={{ marginLeft: 'auto' }}
                  aria-label={`${assignment.login} 지정 취소`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(assignment.login)}
                >
                  지정 취소
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </section>
  );
}
