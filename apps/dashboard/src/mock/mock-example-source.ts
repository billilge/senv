import type { ApiSchemas } from '@senv/api-client';

/**
 * 목업의 .env.example 연결 (M1.2). GitHub 대신 App이 설치된 저장소 두 개와 기본 브랜치의 예시 파일을 둔다.
 * server는 이미 연결되어 있고, 마지막 확인 뒤에 예시 파일에 PAYMENT_SECRET_KEY가 더해진 상태다.
 * "지금 확인"을 누르면 그 키가 선택 키로 등록되는 흐름을 볼 수 있다.
 */

type ExampleSource = ApiSchemas['ExampleSource'];

export interface MockExampleSource extends ExampleSource {
  /** 마지막으로 읽은 파일 내용. 지금 파일과 같으면 다시 처리하지 않는다 */
  lastText: string | null;
}

export const MOCK_INSTALL_URL = 'https://github.com/apps/senv/installations/new';

export const MOCK_REPOSITORIES = [
  { id: 101, fullName: 'billilge/stream-server' },
  { id: 102, fullName: 'billilge/stream-web' },
];

const SERVER_EXAMPLE_BEFORE = [
  '# HTTP 포트',
  'API_PORT=8080',
  'DATABASE_URL=mysql://user:password@localhost:3306/stream',
  'LOG_LEVEL=debug',
  'REDIS_URL=redis://localhost:6379',
];

/** 저장소 기본 브랜치의 예시 파일 (저장소:경로) */
export const MOCK_EXAMPLE_FILES: Record<string, string> = {
  'billilge/stream-server:.env.example': [
    ...SERVER_EXAMPLE_BEFORE,
    '# 결제 연동 비밀 키',
    'PAYMENT_SECRET_KEY=',
  ].join('\n'),
  'billilge/stream-web:.env.example': [
    '# API 주소',
    'VITE_API_URL=http://localhost:8080',
    '# 브라우저 오류 수집',
    'VITE_SENTRY_DSN=',
  ].join('\n'),
};

export const exampleFileUrl = (repoFullName: string, path: string) =>
  `https://github.com/${repoFullName}/blob/HEAD/${path}`;

export function initialExampleSources(): Record<string, MockExampleSource> {
  return {
    server: {
      repoId: 101,
      repoFullName: 'billilge/stream-server',
      path: '.env.example',
      fileUrl: exampleFileUrl('billilge/stream-server', '.env.example'),
      lastResult: 'ok',
      lastMessage: null,
      lastCheckedAt: '2026-10-08T09:00:00.000Z',
      keys: ['API_PORT', 'DATABASE_URL', 'LOG_LEVEL', 'REDIS_URL'],
      lastAdded: ['REDIS_URL'],
      lastRemoved: [],
      skipped: [],
      lastText: SERVER_EXAMPLE_BEFORE.join('\n'),
    },
  };
}

export function exampleSourceView({ lastText: _, ...view }: MockExampleSource): ExampleSource {
  return view;
}
