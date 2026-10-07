type Reply = { status: number; body?: unknown };
type Handler = (body: unknown) => Reply;

/** 경로별로 응답을 정해 두는 가짜 서버. 실제 api-client에 fetch로 끼운다 */
export class FakeApi {
  readonly requests: { method: string; path: string; body: unknown }[] = [];
  private readonly routes = new Map<string, Handler[]>();

  /** 같은 경로를 여러 번 주면 차례로 쓰고, 마지막 응답은 계속 쓴다 */
  on(method: string, path: string, ...handlers: Handler[]): this {
    this.routes.set(`${method} ${path}`, handlers);
    return this;
  }

  reply(method: string, path: string, ...replies: Reply[]): this {
    return this.on(method, path, ...replies.map((reply) => () => reply));
  }

  readonly fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const text = await request.text();
    const body = text ? JSON.parse(text) : undefined;
    this.requests.push({ method: request.method, path: url.pathname, body });
    const handlers = this.routes.get(`${request.method} ${url.pathname}`);
    const handler = handlers && (handlers.length > 1 ? handlers.shift() : handlers[0]);
    const reply = handler
      ? handler(body)
      : {
          status: 404,
          body: { code: 'not_found', message: `가짜 서버에 없는 경로: ${url.pathname}` },
        };
    return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

export const user = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  githubId: '1',
  login: 'alice',
  name: 'Alice',
  avatarUrl: null,
  role: 'member',
  status: 'active',
  ...overrides,
});

export const unauthorized = {
  status: 401,
  body: { code: 'unauthorized', message: '로그인이 필요합니다' },
};
