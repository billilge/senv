import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, user } from '../testing/fake-api';
import { renderApp } from '../testing/render-app';

const server = () =>
  new FakeApi()
    .reply('GET', '/api/v1/me', { status: 200, body: user() })
    .reply('GET', '/api/v1/projects', { status: 200, body: { projects: [] } });

describe('senv 사용 가이드', () => {
  it('헤더의 가이드 탭에서 들어가고, 목차의 링크마다 같은 id의 장이 있다', async () => {
    const { user: actor } = renderApp('/', server());

    await actor.click(await screen.findByRole('link', { name: '가이드' }));

    expect(await screen.findByRole('heading', { name: 'senv 사용 가이드' })).toBeInTheDocument();
    const toc = screen.getByRole('navigation', { name: '목차' });
    const links = within(toc).getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(10);
    for (const link of links) {
      const id = (link.getAttribute('href') ?? '').replace(/^#/, '');
      const section = document.getElementById(id);
      expect(section, id).not.toBeNull();
      expect(within(section as HTMLElement).getByRole('heading', { level: 3 })).toHaveTextContent(
        link.textContent ?? '',
      );
    }
  });

  it('명령은 복사 버튼으로 클립보드에 넣는다', async () => {
    const { user: actor } = renderApp('/guide', server());

    await actor.click(await screen.findByRole('button', { name: '설치 명령 복사' }));

    expect(await navigator.clipboard.readText()).toBe('npm i -g @billilge/senv');
    expect(await screen.findByRole('button', { name: '복사했습니다' })).toBeInTheDocument();
  });

  it.each([
    'senv login',
    'senv init',
    'senv run -- pnpm dev',
    'senv pull',
    'senv set API_URL=https://api.example.com -m "API 주소 변경"',
    'senv agent install',
    'senv link approve <연결 ID>',
    'senv run -- ./gradlew bootRun',
    'senv init --format properties',
    '/plugin marketplace add billilge/stream-marketplace',
    'senv doctor',
  ])('%s 명령을 안내한다', async (command) => {
    renderApp('/guide', server());
    expect((await screen.findAllByText(command, { selector: 'code' })).length).toBeGreaterThan(0);
  });
});
