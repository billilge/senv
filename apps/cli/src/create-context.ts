import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import * as clack from '@clack/prompts';
import { createSenvClient, unwrap } from '@senv/api-client';
import open from 'open';
import { defaultConfigDir, openCredentialStore } from './auth/credentials.js';
import { osKeyring } from './auth/os-keyring.js';
import { CliSession } from './auth/session.js';
import type { CliContext } from './context.js';
import { DEFAULT_API_URL } from './program.js';

/**
 * 실제 실행 환경의 컨텍스트. 각 부품은 따로 테스트했고, 여기서는 조립만 한다.
 * 출력(out)은 main이 자기 stdout·stderr로 바꿔 끼운다.
 */
export async function createRealContext(): Promise<CliContext> {
  const env = process.env;
  const apiUrl = (env.SENV_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
  const configDir = defaultConfigDir(env, process.platform, homedir());
  // 키체인을 쓸 수 없다는 사실은 토큰을 저장하는 login에서 알린다
  const credentials = await openCredentialStore({ configDir, keyring: osKeyring, warn: () => {} });

  const anonymousApi = createSenvClient({ baseUrl: apiUrl });
  const session = new CliSession({
    apiUrl,
    store: credentials,
    lockPath: join(configDir, 'refresh.lock'),
    refresh: (refreshToken) =>
      unwrap(anonymousApi.POST('/api/v1/auth/token/refresh', { body: { refreshToken } })),
  });

  return {
    cwd: process.cwd(),
    env,
    apiUrl,
    out: { info: () => {}, warn: () => {}, result: () => {} },
    api: createSenvClient({ baseUrl: apiUrl, accessToken: () => session.accessToken() }),
    anonymousApi,
    credentials,
    prompt: {
      select: async (message, choices) => {
        const value = await clack.select({
          message,
          options: choices.map((choice) => ({
            value: choice.value,
            label: choice.label,
            hint: choice.hint,
          })) as never,
        });
        if (clack.isCancel(value)) throw new Error('취소했습니다');
        return value as never;
      },
    },
    openBrowser: async (url) => {
      await open(url);
    },
    sleep: (ms) => sleep(ms),
    now: () => new Date(),
  };
}
