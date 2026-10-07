import { z } from 'zod';
import type { Keyring } from '../crypto/envelope.js';
import { KeyringConfigError, loadKeyring } from '../crypto/keyring.js';

export interface ServerConfig {
  port: number;
  /** 대시보드 기준 주소. 끝의 `/`는 뺀다 (예: https://senv.stream.billilge.site) */
  appUrl: string;
  databaseUrl: string;
  storage: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  };
  keyring: Keyring;
  sessionSecret: string;
  github: {
    clientId: string;
    clientSecret: string;
    org: string;
  };
  /** 로그인하자마자 관리자가 되는 GitHub 사용자명 (소문자) */
  bootstrapAdmins: string[];
}

/** 부트스트랩 환경변수 문제. 변수 이름과 이유만 담고 값은 담지 않는다 */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`서버 설정이 올바르지 않습니다:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

const GITHUB_ORG_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
/** GitHub 사용자명: 영숫자와 하이픈(연속·앞뒤 불가), 39자 이하 */
const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

const required = () => z.string().trim().min(1, { error: '값이 없습니다', abort: true });

const databaseUrl = required().refine(
  (value) => value.startsWith('mysql://') && URL.canParse(value),
  {
    error: 'mysql:// 로 시작하는 주소여야 합니다',
  },
);

/** 오류 메시지는 모두 직접 정해서, zod가 입력 값을 메시지에 넣지 않게 한다 */
const envSchema = z.object({
  PORT: z
    .string()
    .trim()
    .refine((value) => value === '' || (/^\d{1,5}$/.test(value) && Number(value) <= 65535), {
      error: '1~65535 사이의 숫자여야 합니다',
    }),
  APP_URL: required().refine(isAppUrl, {
    error: 'https 주소여야 합니다 (로컬 개발은 http://localhost 허용)',
  }),
  DATABASE_URL: databaseUrl,
  S3_ENDPOINT: required().refine(isHttpUrl, { error: 'http(s) 주소여야 합니다' }),
  S3_ACCESS_KEY_ID: required(),
  S3_SECRET_ACCESS_KEY: required(),
  S3_BUCKET: required(),
  SESSION_SECRET: required().min(32, { error: '32자 이상이어야 합니다' }),
  GITHUB_CLIENT_ID: required(),
  GITHUB_CLIENT_SECRET: required(),
  GITHUB_ORG: required().regex(GITHUB_ORG_NAME, { error: 'GitHub 조직 이름 형식이 아닙니다' }),
  SENV_BOOTSTRAP_ADMINS: z
    .string()
    .transform(splitList)
    .refine((logins) => logins.every((login) => GITHUB_LOGIN.test(login)), {
      error: '쉼표로 구분한 GitHub 사용자명 목록이어야 합니다',
    }),
});

/**
 * 부트스트랩 환경변수(PRD 4.5)를 검사해 설정 객체를 만든다.
 * 문제가 있으면 모든 문제를 모아 ConfigError로 기동을 막는다.
 */
export function loadServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const problems: string[] = [];

  const input = Object.fromEntries(
    Object.keys(envSchema.shape).map((key) => [key, env[key] ?? '']),
  );
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const reported = new Set<string>();
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0]);
      if (reported.has(name)) continue; // 변수마다 첫 문제만 알린다
      reported.add(name);
      problems.push(`${name}: ${issue.message}`);
    }
  }

  let keyring: Keyring | undefined;
  try {
    keyring = loadKeyring(env);
  } catch (error) {
    if (!(error instanceof KeyringConfigError)) throw error;
    problems.push(error.message);
  }

  if (!parsed.success || !keyring || problems.length > 0) throw new ConfigError(problems);

  const vars = parsed.data;
  return {
    port: vars.PORT === '' ? 3000 : Number(vars.PORT),
    appUrl: vars.APP_URL.replace(/\/+$/, ''),
    databaseUrl: vars.DATABASE_URL,
    storage: {
      endpoint: vars.S3_ENDPOINT,
      accessKeyId: vars.S3_ACCESS_KEY_ID,
      secretAccessKey: vars.S3_SECRET_ACCESS_KEY,
      bucket: vars.S3_BUCKET,
    },
    keyring,
    sessionSecret: vars.SESSION_SECRET,
    github: {
      clientId: vars.GITHUB_CLIENT_ID,
      clientSecret: vars.GITHUB_CLIENT_SECRET,
      org: vars.GITHUB_ORG,
    },
    bootstrapAdmins: vars.SENV_BOOTSTRAP_ADMINS.map((login) => login.toLowerCase()),
  };
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === 'https:' || protocol === 'http:';
}

function isAppUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
}

export interface WorkerConfig {
  databaseUrl: string;
}

/** worker는 DB만 쓰므로 DATABASE_URL만 받는다. R2 키·KEK·OAuth 시크릿은 api에만 둔다 */
export function loadWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const parsed = databaseUrl.safeParse(env.DATABASE_URL ?? '');
  if (!parsed.success) {
    throw new ConfigError([`DATABASE_URL: ${parsed.error.issues[0]?.message}`]);
  }
  return { databaseUrl: parsed.data };
}
