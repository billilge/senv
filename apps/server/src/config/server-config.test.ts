import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadServerConfig, loadWorkerConfig } from './server-config.js';

const KEK = randomBytes(32).toString('base64');

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    APP_URL: 'https://senv.stream.billilge.site/',
    DATABASE_URL: 'mysql://stream_env:pw@mysql:3306/stream_env',
    S3_ENDPOINT: 'https://acc123.r2.cloudflarestorage.com',
    S3_ACCESS_KEY_ID: 'access-key-id',
    S3_SECRET_ACCESS_KEY: 'secret-access-key',
    S3_BUCKET: 'stream-env',
    SENV_KEK: KEK,
    SENV_KEK_ID: 'kek-2026-10',
    SESSION_SECRET: 'x'.repeat(32),
    GITHUB_CLIENT_ID: 'Iv1.client',
    GITHUB_CLIENT_SECRET: 'github-client-secret',
    GITHUB_ORG: 'billilge',
    ...overrides,
  };
}

function problemsOf(env: Record<string, string | undefined>): string[] {
  try {
    loadServerConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).problems;
  }
  throw new Error('ConfigError가 나야 합니다');
}

describe('loadServerConfig', () => {
  it('값이 모두 맞으면 묶음 단위의 설정 객체를 만든다', () => {
    const config = loadServerConfig(validEnv());
    expect(config).toMatchObject({
      port: 3000,
      appUrl: 'https://senv.stream.billilge.site',
      databaseUrl: 'mysql://stream_env:pw@mysql:3306/stream_env',
      storage: {
        endpoint: 'https://acc123.r2.cloudflarestorage.com',
        accessKeyId: 'access-key-id',
        secretAccessKey: 'secret-access-key',
        bucket: 'stream-env',
      },
      sessionSecret: 'x'.repeat(32),
      github: { clientId: 'Iv1.client', clientSecret: 'github-client-secret', org: 'billilge' },
    });
    expect(config.keyring.currentKekId).toBe('kek-2026-10');
  });

  it('PORT를 숫자로 바꾼다', () => {
    expect(loadServerConfig(validEnv({ PORT: '8080' })).port).toBe(8080);
  });

  it('TRUST_PROXY는 믿을 프록시 단계 수다. 비우면 1 (Coolify의 Traefik)', () => {
    expect(loadServerConfig(validEnv()).trustProxyHops).toBe(1);
    expect(loadServerConfig(validEnv({ TRUST_PROXY: '2' })).trustProxyHops).toBe(2);
    expect(loadServerConfig(validEnv({ TRUST_PROXY: '0' })).trustProxyHops).toBe(0);
    expect(problemsOf(validEnv({ TRUST_PROXY: 'true' }))).toEqual([
      'TRUST_PROXY: 0~5 사이의 숫자여야 합니다',
    ]);
  });

  it('빠진 변수를 한 번에 모두 알려준다', () => {
    const problems = problemsOf({}).join('\n');
    for (const name of [
      'APP_URL',
      'DATABASE_URL',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_BUCKET',
      'SENV_KEK',
      'SESSION_SECRET',
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
      'GITHUB_ORG',
    ]) {
      expect(problems).toContain(name);
    }
  });

  it.each([
    ['PORT가 숫자가 아님', { PORT: 'http' }, 'PORT'],
    ['DATABASE_URL이 mysql://가 아님', { DATABASE_URL: 'postgres://u:pw@db/app' }, 'DATABASE_URL'],
    ['APP_URL이 http (localhost 아님)', { APP_URL: 'http://senv.example.com' }, 'APP_URL'],
    ['S3_ENDPOINT가 URL이 아님', { S3_ENDPOINT: 'r2-endpoint' }, 'S3_ENDPOINT'],
    ['SESSION_SECRET이 32자 미만', { SESSION_SECRET: 'too-short' }, 'SESSION_SECRET'],
    ['GITHUB_ORG에 공백', { GITHUB_ORG: 'bad org' }, 'GITHUB_ORG'],
    ['SENV_KEK 길이가 틀림', { SENV_KEK: randomBytes(16).toString('base64') }, 'SENV_KEK'],
  ])('%s → 그 변수를 문제로 알린다', (_label, overrides, name) => {
    const problems = problemsOf(validEnv(overrides));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(name);
  });

  describe('SENV_BOOTSTRAP_ADMINS', () => {
    it('쉼표로 구분한 GitHub 사용자명을 공백을 빼고 소문자로 읽는다', () => {
      const config = loadServerConfig(validEnv({ SENV_BOOTSTRAP_ADMINS: ' Alice, bob-2 ,' }));
      expect(config.bootstrapAdmins).toEqual(['alice', 'bob-2']);
    });

    it('없거나 비어 있으면 빈 목록이다', () => {
      expect(loadServerConfig(validEnv()).bootstrapAdmins).toEqual([]);
      expect(loadServerConfig(validEnv({ SENV_BOOTSTRAP_ADMINS: '' })).bootstrapAdmins).toEqual([]);
    });

    it.each(['bad name', '-alice', 'alice--x', 'a'.repeat(40)])(
      'GitHub 사용자명 형식이 아니면(%s) 문제로 알린다',
      (value) => {
        const problems = problemsOf(validEnv({ SENV_BOOTSTRAP_ADMINS: `ok-user,${value}` }));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('SENV_BOOTSTRAP_ADMINS');
      },
    );
  });

  it('로컬 개발용 http://localhost 는 APP_URL로 허용한다', () => {
    expect(loadServerConfig(validEnv({ APP_URL: 'http://localhost:5173' })).appUrl).toBe(
      'http://localhost:5173',
    );
  });

  it('오류 메시지에 비밀 값을 담지 않는다', () => {
    const env = validEnv({
      DATABASE_URL: 'postgres://u:db-password-123@db/app',
      SESSION_SECRET: 'short-session-secret',
    });
    try {
      loadServerConfig(env);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const text = `${(error as Error).message}\n${(error as ConfigError).problems.join('\n')}`;
      expect(text).not.toContain('db-password-123');
      expect(text).not.toContain('short-session-secret');
    }
  });

  describe('GitHub App (.env.example 연결, 결정 73)', () => {
    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs1', format: 'pem' })
      .toString()
      .trim();
    const app = {
      GITHUB_APP_ID: '123456',
      GITHUB_APP_PRIVATE_KEY: pem,
      GITHUB_APP_WEBHOOK_SECRET: 'hook-secret',
    };
    const ALL_REQUIRED =
      'GitHub App을 쓰려면 GITHUB_APP_ID·GITHUB_APP_PRIVATE_KEY·GITHUB_APP_WEBHOOK_SECRET이 모두 있어야 합니다';

    it('세 변수가 모두 없으면 꺼진다', () => {
      expect(loadServerConfig(validEnv()).githubApp).toBeNull();
    });

    it('세 변수가 모두 있으면 켜진다. 한 줄로 넣은 개인 키의 \\n은 줄바꿈으로 읽는다', () => {
      expect(loadServerConfig(validEnv(app)).githubApp).toEqual({
        appId: '123456',
        privateKey: pem,
        webhookSecret: 'hook-secret',
        slug: null,
      });
      const oneLine = validEnv({
        ...app,
        GITHUB_APP_PRIVATE_KEY: pem.replaceAll('\n', '\\n'),
        GITHUB_APP_SLUG: 'senv-stream',
      });
      expect(loadServerConfig(oneLine).githubApp).toMatchObject({
        privateKey: pem,
        slug: 'senv-stream',
      });
    });

    it('일부만 있으면 빠진 변수를 알린다', () => {
      expect(problemsOf(validEnv({ GITHUB_APP_ID: '123456' }))).toEqual([
        `GITHUB_APP_PRIVATE_KEY: ${ALL_REQUIRED}`,
        `GITHUB_APP_WEBHOOK_SECRET: ${ALL_REQUIRED}`,
      ]);
    });

    it('형식이 틀리면 알리고, 값은 메시지에 담지 않는다', () => {
      const problems = problemsOf(
        validEnv({
          ...app,
          GITHUB_APP_ID: 'abc',
          GITHUB_APP_PRIVATE_KEY: 'not-a-pem-secret',
          GITHUB_APP_SLUG: 'Bad Slug',
        }),
      );
      expect(problems).toEqual([
        'GITHUB_APP_ID: 숫자여야 합니다',
        'GITHUB_APP_PRIVATE_KEY: PEM 형식의 개인 키여야 합니다',
        'GITHUB_APP_SLUG: 소문자·숫자·하이픈이어야 합니다',
      ]);
      expect(problems.join('\n')).not.toContain('not-a-pem-secret');
    });
  });
});

describe('loadWorkerConfig', () => {
  const workerEnv = (overrides: Record<string, string | undefined> = {}) => ({
    DATABASE_URL: 'mysql://stream_env:pw@mysql:3306/stream_env',
    S3_ENDPOINT: 'https://acc123.r2.cloudflarestorage.com',
    S3_ACCESS_KEY_ID: 'access-key-id',
    S3_SECRET_ACCESS_KEY: 'secret-access-key',
    S3_BUCKET: 'stream-env',
    SENV_KEK: KEK,
    SENV_KEK_ID: 'kek-2026-10',
    ...overrides,
  });

  it('worker는 DB·R2·KEK만 받는다 (OAuth 시크릿·세션 비밀은 api에만)', () => {
    const config = loadWorkerConfig(workerEnv());
    expect(config).toMatchObject({
      databaseUrl: 'mysql://stream_env:pw@mysql:3306/stream_env',
      storage: {
        endpoint: 'https://acc123.r2.cloudflarestorage.com',
        accessKeyId: 'access-key-id',
        secretAccessKey: 'secret-access-key',
        bucket: 'stream-env',
      },
    });
    expect(config.keyring.currentKekId).toBe('kek-2026-10');
    expect(Object.keys(config).sort()).toEqual(['databaseUrl', 'keyring', 'storage']);
  });

  it('빠지거나 틀린 값을 한 번에 알리고, 값은 메시지에 담지 않는다', () => {
    const env = workerEnv({
      DATABASE_URL: 'postgres://u:pw@db/app',
      S3_BUCKET: undefined,
      SENV_KEK: undefined,
    });
    expect(() => loadWorkerConfig(env)).toThrow(ConfigError);
    try {
      loadWorkerConfig(env);
    } catch (error) {
      const problems = (error as ConfigError).problems;
      expect(problems).toContain('DATABASE_URL: mysql:// 로 시작하는 주소여야 합니다');
      expect(problems).toContain('S3_BUCKET: 값이 없습니다');
      expect(problems.some((problem) => problem.startsWith('SENV_KEK'))).toBe(true);
      expect((error as ConfigError).message).not.toContain('pw@');
    }
  });
});
