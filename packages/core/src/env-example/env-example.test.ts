import { describe, expect, it } from 'vitest';
import { diffKeyNames, parseEnvExample, planExampleImport } from './index';

describe('parseEnvExample', () => {
  it('키 이름만 꺼내고 값은 돌려주지 않는다', () => {
    const text = 'DATABASE_URL=postgres://u:real-pass@db/app\nexport PORT=3000\nREDIS_URL=\n';
    const parsed = parseEnvExample(text);
    expect(parsed).toEqual({
      entries: [
        { key: 'DATABASE_URL', description: '' },
        { key: 'PORT', description: '' },
        { key: 'REDIS_URL', description: '' },
      ],
      skipped: [],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/real-pass|3000/);
  });

  it('키 바로 위에 붙은 주석 줄을 설명으로 쓰고, 빈 줄이 끼면 쓰지 않는다', () => {
    const text = [
      '# 이 줄은 빈 줄로 떨어져 있다',
      '',
      '# 캐시용 Redis',
      '#',
      '#   로컬은 docker compose로 띄운다',
      'REDIS_URL=',
      'NO_COMMENT=x',
    ].join('\n');
    expect(parseEnvExample(text).entries).toEqual([
      { key: 'REDIS_URL', description: '캐시용 Redis 로컬은 docker compose로 띄운다' },
      { key: 'NO_COMMENT', description: '' },
    ]);
  });

  it('위에 주석이 없으면 같은 줄 뒤의 주석을 설명으로 쓴다', () => {
    const text = ['PORT=3000 # 서버 포트', 'NAME="a # b" # 앱 이름', 'HASH=a#b'].join('\n');
    expect(parseEnvExample(text).entries).toEqual([
      { key: 'PORT', description: '서버 포트' },
      { key: 'NAME', description: '앱 이름' },
      { key: 'HASH', description: '' },
    ]);
  });

  it('규칙에 맞지 않는 줄은 건너뛰고 줄 번호와 이유만 남긴다 (내용은 남기지 않는다)', () => {
    const text = ['api_url=https://secret-host', 'JUST_TEXT', 'OK=1'].join('\n');
    const parsed = parseEnvExample(text);
    expect(parsed).toEqual({
      entries: [{ key: 'OK', description: '' }],
      skipped: [
        { line: 1, reason: 'invalid_key' },
        { line: 2, reason: 'no_assignment' },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain('secret-host');
  });

  it('여러 줄 따옴표 값 안의 줄은 키로 읽지 않는다', () => {
    const text = [
      'PRIVATE_KEY="-----BEGIN KEY-----',
      'MIIEvQIBADANBg=',
      '-----END KEY-----"',
      'NEXT=1',
    ].join('\n');
    expect(parseEnvExample(text)).toEqual({
      entries: [
        { key: 'PRIVATE_KEY', description: '' },
        { key: 'NEXT', description: '' },
      ],
      skipped: [],
    });
  });

  it('같은 키가 여러 번 나오면 처음 것만 쓴다', () => {
    const text = ['# 처음', 'A=1', '# 두 번째', 'A=2'].join('\n');
    expect(parseEnvExample(text).entries).toEqual([{ key: 'A', description: '처음' }]);
  });

  it('설명은 500자에서 자른다', () => {
    const [entry] = parseEnvExample(`# ${'가'.repeat(600)}\nA=`).entries;
    expect(entry?.description).toHaveLength(500);
  });

  it('CRLF 줄바꿈도 읽는다', () => {
    expect(parseEnvExample('# 설명\r\nA=1\r\nB=2\r\n').entries).toEqual([
      { key: 'A', description: '설명' },
      { key: 'B', description: '' },
    ]);
  });
});

describe('planExampleImport', () => {
  const entries = [
    { key: 'API_URL', description: '이미 있는 키' },
    { key: 'REDIS_URL', description: '캐시' },
    { key: 'VITE_SENTRY_DSN', description: '' },
  ];

  it('스키마에 없는 키만 등록하고, 이미 있는 키는 건드리지 않는다', () => {
    expect(planExampleImport(entries, [{ key: 'API_URL' }], [])).toEqual([
      { key: 'REDIS_URL', visibility: 'secret', description: '캐시' },
      { key: 'VITE_SENTRY_DSN', visibility: 'secret', description: '' },
    ]);
  });

  it('공개 접두사로 시작하는 키는 public으로 등록한다 (secret이면 노출 검사에 걸린다)', () => {
    expect(planExampleImport(entries, [{ key: 'API_URL' }], ['VITE_'])).toEqual([
      { key: 'REDIS_URL', visibility: 'secret', description: '캐시' },
      { key: 'VITE_SENTRY_DSN', visibility: 'public', description: '' },
    ]);
  });
});

describe('diffKeyNames', () => {
  it('이전 예시와 비교해 더해진 키와 빠진 키를 이름 순으로 돌려준다', () => {
    expect(diffKeyNames(['B', 'A', 'OLD'], ['NEW_B', 'A', 'B', 'NEW_A'])).toEqual({
      added: ['NEW_A', 'NEW_B'],
      removed: ['OLD'],
    });
  });
});
