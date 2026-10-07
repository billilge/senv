import { Button, Flash, FormControl, Heading, Stack, Text, TextInput } from '@primer/react';
import { SenvApiError, unwrap } from '@senv/api-client';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../api-context';

type Decision = 'approve' | 'deny';

/** senv login이 연 주소. 터미널에 보이는 코드를 확인하고 승인하거나 거절한다 (PRD 9.2) */
export function DevicePage({ code }: { code?: string }) {
  const api = useApi();
  const [userCode, setUserCode] = useState(code ?? '');
  const decide = useMutation({
    mutationFn: async (decision: Decision) => {
      await unwrap(api.POST('/api/v1/auth/device/approve', { body: { userCode, decision } }));
      return decision;
    },
  });

  if (decide.isSuccess) {
    return (
      <Flash variant={decide.data === 'approve' ? 'success' : 'default'}>
        {decide.data === 'approve'
          ? 'CLI 로그인을 승인했습니다. 터미널로 돌아가세요.'
          : 'CLI 로그인 요청을 거절했습니다.'}
      </Flash>
    );
  }

  return (
    <Stack>
      <Heading as="h2">CLI 로그인 승인</Heading>
      <Text>
        터미널에 표시된 코드와 같은지 확인하세요. 본인이 실행한 senv login이 아니면 거절하세요.
      </Text>
      {decide.isError && (
        <Flash variant="danger">
          {decide.error instanceof SenvApiError
            ? decide.error.message
            : '요청을 보내지 못했습니다.'}
        </Flash>
      )}
      <FormControl>
        <FormControl.Label>코드</FormControl.Label>
        <TextInput value={userCode} onChange={(event) => setUserCode(event.target.value)} />
      </FormControl>
      <Stack direction="horizontal">
        <Button
          variant="primary"
          disabled={!userCode || decide.isPending}
          onClick={() => decide.mutate('approve')}
        >
          승인
        </Button>
        <Button disabled={!userCode || decide.isPending} onClick={() => decide.mutate('deny')}>
          거절
        </Button>
      </Stack>
    </Stack>
  );
}
