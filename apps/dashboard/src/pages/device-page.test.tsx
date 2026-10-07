import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const signedIn = () => new FakeApi().reply('GET', '/api/v1/me', { status: 200, body: user() });

describe('CLI 로그인 승인 화면', () => {
  it('주소의 코드를 채워 보여주고, 승인하면 서버에 보내고 터미널로 돌아가라고 안내한다', async () => {
    const api = signedIn().reply('POST', '/api/v1/auth/device/approve', { status: 204 });
    const { user: actor } = renderApp('/device?code=BCDF-GHJK', api);

    expect(await screen.findByRole('textbox', { name: '코드' })).toHaveValue('BCDF-GHJK');
    await actor.click(screen.getByRole('button', { name: '승인' }));

    expect(await screen.findByText(/터미널로 돌아가/)).toBeInTheDocument();
    expect(api.requests.at(-1)).toMatchObject({
      method: 'POST',
      path: '/api/v1/auth/device/approve',
      body: { userCode: 'BCDF-GHJK', decision: 'approve' },
    });
  });

  it('거절하면 거절을 보내고 그렇게 안내한다', async () => {
    const api = signedIn().reply('POST', '/api/v1/auth/device/approve', { status: 204 });
    const { user: actor } = renderApp('/device?code=BCDF-GHJK', api);

    await actor.click(await screen.findByRole('button', { name: '거절' }));

    expect(await screen.findByText(/거절했습니다/)).toBeInTheDocument();
    expect(api.requests.at(-1)?.body).toEqual({ userCode: 'BCDF-GHJK', decision: 'deny' });
  });

  it('주소에 코드가 없으면 직접 입력해서 승인할 수 있다', async () => {
    const api = signedIn().reply('POST', '/api/v1/auth/device/approve', { status: 204 });
    const { user: actor } = renderApp('/device', api);

    await actor.type(await screen.findByRole('textbox', { name: '코드' }), 'wxyz-bcdf');
    await actor.click(screen.getByRole('button', { name: '승인' }));

    expect(await screen.findByText(/터미널로 돌아가/)).toBeInTheDocument();
    expect(api.requests.at(-1)?.body).toEqual({ userCode: 'wxyz-bcdf', decision: 'approve' });
  });

  it('서버가 거부하면(만료 등) 서버의 안내를 보여주고 다시 시도할 수 있다', async () => {
    const api = signedIn().reply('POST', '/api/v1/auth/device/approve', {
      status: 410,
      body: {
        code: 'device_code_expired',
        message: '코드가 만료되었습니다. CLI에서 senv login을 다시 실행하세요',
      },
    });
    const { user: actor } = renderApp('/device?code=BCDF-GHJK', api);

    await actor.click(await screen.findByRole('button', { name: '승인' }));

    expect(await screen.findByText(/코드가 만료되었습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '승인' })).toBeEnabled();
  });
});
