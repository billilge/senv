import { readFileSync } from 'node:fs';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, unauthorized } from './testing/fake-api';
import { renderApp } from './testing/render-app';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('다크 모드 전용', () => {
  it('OS 설정과 관계없이 Primer 테마를 다크로 고정한다', async () => {
    renderApp('/login', new FakeApi().reply('GET', '/api/v1/me', unauthorized));
    await screen.findByRole('link', { name: /GitHub로 로그인/ });

    const theme = document.querySelector('[data-component="ThemeProvider"]');
    expect(theme).toHaveAttribute('data-color-mode', 'dark');
    expect(theme).toHaveAttribute('data-dark-theme', 'dark');
  });

  it('페이지 전체(html)에 다크 테마를 걸어 body 배경까지 GitHub 다크 배경색이 된다', () => {
    const html = read('../index.html');
    expect(html).toMatch(/<html[^>]*data-color-mode="dark"/);
    expect(html).toMatch(/<html[^>]*data-dark-theme="dark"/);
    expect(html).toContain('<meta name="color-scheme" content="dark" />');

    const css = read('./global.css');
    expect(css).toMatch(/body\s*{[^}]*background-color:\s*var\(--bgColor-default\)/);
  });

  it('라이트 테마 CSS는 불러오지 않는다', () => {
    const main = read('./main.tsx');
    expect(main).toContain('themes/dark.css');
    expect(main).not.toContain('themes/light.css');
  });
});
