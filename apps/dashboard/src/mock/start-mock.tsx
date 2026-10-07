import { BaseStyles, Button, Stack, Text, ThemeProvider } from '@primer/react';
import { createSenvClient } from '@senv/api-client';
import { initialMockState, type MockPersona, MockServer, type MockState } from './mock-server';

const STORAGE_KEY = 'senv-mock-state';

/** 새로 고쳐도 목업 데이터가 남도록 브라우저에 저장한다. 저장소를 못 쓰면 처음 데이터로 시작한다 */
function load(): MockState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as MockState | null;
    if (saved?.users && saved.projects && saved.values) return saved;
  } catch {
    // 저장소를 못 쓰거나 내용이 깨졌으면 처음 데이터로 시작한다
  }
  return initialMockState();
}

function save(state: MockState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 저장하지 못해도 이번 화면에서는 계속 쓸 수 있다
  }
}

export function startMock() {
  const server = new MockServer(load(), save, 300);

  // vite.config.ts의 목업 플러그인이 GitHub 로그인(/auth/github)을 여기로 돌려보낸다
  if (window.location.pathname === '/__mock/login') {
    server.signIn();
    const next = new URLSearchParams(window.location.search).get('next');
    const safe = next?.startsWith('/') && !next.startsWith('//') ? next : '/';
    window.history.replaceState(null, '', safe);
  }

  const client = createSenvClient({ baseUrl: window.location.origin, fetch: server.fetch });
  return { client, toolbar: <MockToolbar server={server} /> };
}

const PERSONAS: [MockPersona, string][] = [
  ['admin', '관리자 alice'],
  ['member', '멤버 carol'],
  ['pending', '승인 대기 bob'],
  ['signed-out', '로그아웃'],
];

/** 화면 오른쪽 아래의 목업 도구: 역할 바꾸기, 데이터 초기화 */
function MockToolbar({ server }: { server: MockServer }) {
  const reload = () => window.location.reload();
  return (
    <ThemeProvider colorMode="auto">
      <BaseStyles>
        <div
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            padding: 8,
            maxWidth: 'calc(100vw - 32px)',
            background: 'var(--bgColor-default)',
            border: '1px solid var(--borderColor-default)',
            borderRadius: 'var(--borderRadius-large)',
            boxShadow: 'var(--shadow-floating-small)',
          }}
        >
          <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
            <Text size="small" weight="semibold">
              목업
            </Text>
            {PERSONAS.map(([persona, label]) => (
              <Button
                key={persona}
                size="small"
                variant={server.persona === persona ? 'primary' : 'default'}
                onClick={() => {
                  server.setPersona(persona);
                  reload();
                }}
              >
                {label}
              </Button>
            ))}
            <Button
              size="small"
              variant="invisible"
              onClick={() => {
                server.reset();
                reload();
              }}
            >
              데이터 초기화
            </Button>
          </Stack>
        </div>
      </BaseStyles>
    </ThemeProvider>
  );
}
