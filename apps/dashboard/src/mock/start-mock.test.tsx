import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../app';
import { initialMockState } from './mock-server';
import { startMock } from './start-mock';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('목업 모드 (pnpm dev:mock)', () => {
  it('서버 없이 예시 데이터로 앱 전체가 그려지고, 역할 바꾸기 도구가 보인다', async () => {
    const { client, toolbar } = startMock();
    render(
      <>
        <App client={client} history={createMemoryHistory({ initialEntries: ['/'] })} />
        {toolbar}
      </>,
    );

    expect(
      await screen.findByRole('link', { name: 'server' }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '관리자 alice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '데이터 초기화' })).toBeInTheDocument();
  });

  it('GitHub 로그인 대신 /__mock/login으로 오면 마지막 역할로 로그인하고 가려던 곳으로 보낸다', () => {
    const signedOut = { ...initialMockState(), persona: 'signed-out', lastPersona: 'member' };
    localStorage.setItem('senv-mock-state', JSON.stringify(signedOut));
    window.history.replaceState(null, '', '/__mock/login?next=%2Fadmin%2Fusers');

    startMock();

    expect(window.location.pathname).toBe('/admin/users');
    expect(JSON.parse(localStorage.getItem('senv-mock-state') ?? '{}').persona).toBe('member');
  });

  it('next가 다른 사이트를 가리키면 첫 화면으로 보낸다', () => {
    window.history.replaceState(null, '', '/__mock/login?next=%2F%2Fevil.example');
    startMock();
    expect(window.location.pathname).toBe('/');
  });
});
