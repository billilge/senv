import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadServerConfig } from './server-config.js';

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
});
