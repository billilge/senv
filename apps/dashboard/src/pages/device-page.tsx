import { CheckCircleIcon, TerminalIcon, XCircleIcon } from '@primer/octicons-react';
import { Button, Flash, FormControl, Stack, TextInput } from '@primer/react';
import { SenvApiError, unwrap } from '@senv/api-client';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../api-context';
import card from '../ui/card.module.css';

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
    const approved = decide.data === 'approve';
    return (
      <div className={card.page}>
        <div className={card.card}>
          {approved ? (
            <CheckCircleIcon size={48} className={card.logo} />
          ) : (
            <XCircleIcon size={48} className={card.logo} />
          )}
          <Flash variant={approved ? 'success' : 'default'}>
            {approved
              ? 'CLI 로그인을 승인했습니다. 터미널로 돌아가세요.'
              : 'CLI 로그인 요청을 거절했습니다.'}
          </Flash>
        </div>
      </div>
    );
  }

  return (
    <div className={card.page}>
      <div className={card.card}>
        <TerminalIcon size={48} className={card.logo} />
        <h2 className={card.title}>CLI 로그인 승인</h2>
        {decide.isError && (
          <Flash variant="danger">
            {decide.error instanceof SenvApiError
              ? decide.error.message
              : '요청을 보내지 못했습니다.'}
          </Flash>
        )}
        <div className={card.box}>
          <p className={card.note}>
            터미널에 표시된 코드와 같은지 확인하세요. 본인이 실행한 senv login이 아니면 거절하세요.
          </p>
          <FormControl>
            <FormControl.Label>코드</FormControl.Label>
            <TextInput
              block
              size="large"
              className={card.code}
              placeholder="XXXX-XXXX"
              value={userCode}
              onChange={(event) => setUserCode(event.target.value)}
            />
          </FormControl>
          <Stack direction="horizontal" gap="condensed">
            <Button
              variant="primary"
              block
              disabled={!userCode || decide.isPending}
              onClick={() => decide.mutate('approve')}
            >
              승인
            </Button>
            <Button
              block
              disabled={!userCode || decide.isPending}
              onClick={() => decide.mutate('deny')}
            >
              거절
            </Button>
          </Stack>
        </div>
      </div>
    </div>
  );
}
