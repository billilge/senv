import { expect, test } from '@playwright/test';

const url = (path: string) => `${process.env.SENV_E2E_URL}${path}`;

test('관리자가 프로젝트를 만들고 값을 게시한 뒤, 배포 대상에 연결해 동기화한다', async ({
  page,
}) => {
  await page.goto(url('/'));
  await expect(page.getByRole('heading', { name: '프로젝트' })).toBeVisible();

  // 프로젝트 만들기
  await page.getByRole('button', { name: '새 프로젝트' }).click();
  const create = page.getByRole('dialog', { name: '새 프로젝트' });
  await create.getByRole('textbox', { name: '이름', exact: true }).fill('web');
  await create.getByRole('textbox', { name: '표시 이름' }).fill('Stream 웹');
  await create.getByRole('button', { name: '프로젝트 만들기' }).click();
  await page.getByRole('link', { name: 'web', exact: true }).click();

  // local에 값을 넣어 게시
  await page.getByRole('button', { name: 'local 편집' }).click();
  await page.getByRole('textbox', { name: '새 키' }).fill('API_URL');
  await page.getByRole('textbox', { name: '새 값' }).fill('http://localhost:3000');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '변경 확인' }).click();
  await page.getByRole('textbox', { name: '게시 메시지' }).fill('첫 게시');
  await page.getByRole('button', { name: '게시', exact: true }).click();
  await expect(page.getByText('게시했습니다: local v1')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /local.*v1/ })).toBeVisible();

  // 버전 기록에 남는다
  await page.getByRole('link', { name: '버전 기록' }).click();
  await expect(page.getByText('첫 게시')).toBeVisible();

  // 배포 대상 연결 (테스트 서버는 메모리 제공자)
  await page.getByRole('link', { name: /^배포 대상/ }).click();
  await page.getByRole('button', { name: '연결 추가' }).click();
  const connection = page.getByRole('dialog', { name: '연결 추가' });
  await connection.getByRole('textbox', { name: '이름', exact: true }).fill('memory-main');
  await connection.getByLabel('토큰', { exact: true }).fill('test-token');
  await connection.getByRole('button', { name: '연결 확인 후 저장' }).click();
  await expect(page.getByText('memory-main')).toBeVisible();

  // 프로젝트 배포 탭에서 매핑하고 지금 동기화
  await page.goto(url('/projects/web/targets'));
  await page.getByRole('button', { name: '매핑 추가' }).click();
  const mapping = page.getByRole('dialog', { name: '매핑 추가' });
  await mapping.getByRole('combobox', { name: '연결' }).selectOption({ label: 'memory-main' });
  await mapping
    .getByRole('combobox', { name: '리소스' })
    .selectOption({ label: 'stream-web-local' });
  await mapping.getByRole('combobox', { name: '환경' }).selectOption('local');
  await mapping.getByRole('button', { name: '매핑 만들기' }).click();

  await page.getByRole('button', { name: 'stream-web-local 지금 동기화' }).click();
  const sync = page.getByRole('dialog', { name: 'stream-web-local 동기화' });
  await expect(sync.getByText('API_URL')).toBeVisible();
  await sync.getByRole('button', { name: '동기화', exact: true }).click();
  await expect(page.getByText(/stream-web-local에 1개 키를 반영하고 재시작했습니다/)).toBeVisible();
  await expect(page.getByText('성공')).toBeVisible();
});
