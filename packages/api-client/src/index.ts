import createClient, { type Client } from 'openapi-fetch';
import type { components, paths } from './generated/schema.js';

export type ApiSchemas = components['schemas'];
export type SenvClient = Client<paths>;

/** 서버가 { code, message, details } 형식으로 돌려준 오류 */
export class SenvApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SenvApiError';
  }
}

/** 서버에 닿지 못함 (네트워크 오류, DNS 실패 등) */
export class SenvNetworkError extends Error {
  constructor(cause: unknown) {
    super('서버에 연결할 수 없습니다', { cause });
    this.name = 'SenvNetworkError';
  }
}

export interface SenvClientOptions {
  baseUrl: string;
  /** 요청마다 부른다. 값이 없으면 Authorization 헤더를 붙이지 않는다 */
  accessToken?: () => string | undefined | Promise<string | undefined>;
  fetch?: (request: Request) => Promise<Response>;
}

/** openapi.json에서 생성한 타입이 붙은 클라이언트 */
export function createSenvClient(options: SenvClientOptions): SenvClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const { accessToken } = options;
  if (accessToken) {
    client.use({
      async onRequest({ request }) {
        const token = await accessToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
        return request;
      },
    });
  }
  return client;
}

/** 성공이면 data를, 실패면 SenvApiError·SenvNetworkError를 던진다 */
export async function unwrap<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await request;
  } catch (error) {
    // fetch는 연결 실패를 TypeError로 알린다. 그 밖의 오류(토큰 준비 실패 등)는 그대로 둔다
    if (error instanceof TypeError) throw new SenvNetworkError(error);
    throw error;
  }

  const { data, error, response } = result;
  if (response.ok) return data as T;
  if (isApiErrorBody(error)) {
    throw new SenvApiError(response.status, error.code, error.message, error.details);
  }
  throw new SenvApiError(
    response.status,
    'http_error',
    `서버가 ${response.status} ${response.statusText}로 응답했습니다`,
  );
}

function isApiErrorBody(
  value: unknown,
): value is { code: string; message: string; details?: Record<string, unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}
