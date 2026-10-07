import type { SenvClient } from '@senv/api-client';
import type { CredentialStore } from './auth/credentials.js';

/** 사람에게 보여줄 메시지는 stderr, 명령의 결과(값, 키 목록)는 stdout으로 나눈다 */
export interface Output {
  info(message: string): void;
  warn(message: string): void;
  /** 파이프로 넘길 수 있는 결과 */
  result(text: string): void;
}

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

/** 대화형 입력. 운영은 @clack/prompts, 테스트는 정해진 답을 돌려준다 */
export interface Prompt {
  select<T>(message: string, choices: Choice<T>[]): Promise<T>;
}

/** 명령이 바깥 세계와 만나는 모든 것. 테스트에서는 가짜로 바꾼다 */
export interface CliContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  apiUrl: string;
  out: Output;
  /** 저장된 토큰으로 인증하는 클라이언트. 로그인하지 않았으면 NotLoggedInError */
  api: SenvClient;
  /** 인증 없이 부르는 클라이언트 (디바이스 로그인, 토큰 폐기) */
  anonymousApi: SenvClient;
  credentials: CredentialStore;
  prompt: Prompt;
  openBrowser(url: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): Date;
}
