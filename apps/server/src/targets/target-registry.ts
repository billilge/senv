import type { TargetProvider } from '@senv/core';

export class UnknownProviderError extends Error {
  constructor(readonly type: string) {
    super(`지원하지 않는 배포 대상 종류입니다: ${type}`);
    this.name = 'UnknownProviderError';
  }
}

// biome-ignore lint/suspicious/noExplicitAny: 제공자마다 연결·옵션 타입이 다르다
export type AnyProvider = TargetProvider<any, any>;

/** 제공자 레지스트리 (PRD 8.1). 서버는 제공자를 등록만 하고 인프라 지식은 갖지 않는다 */
export class TargetRegistry {
  private readonly providers: Map<string, AnyProvider>;

  constructor(providers: AnyProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.type, provider]));
  }

  get(type: string): AnyProvider {
    const provider = this.providers.get(type);
    if (!provider) throw new UnknownProviderError(type);
    return provider;
  }

  list(): AnyProvider[] {
    return [...this.providers.values()];
  }
}
