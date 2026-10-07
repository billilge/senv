import { InvalidTargetConfigError, TargetAuthError, type TargetProvider } from '@senv/core';
import { describe, expect, it } from 'vitest';

export interface ContractSetup {
  // biome-ignore lint/suspicious/noExplicitAny: 제공자마다 연결·옵션 타입이 다르다
  provider: TargetProvider<any, any>;
  /** 맞는 연결 설정 (parseConnection에 넘길 원래 입력) */
  connection: unknown;
  /** 값을 쓰고 읽을 리소스. 테스트마다 빈 상태로 시작한다 */
  resourceId: string;
  /** parseConnection이 거부해야 하는 입력 */
  invalidConnection: unknown;
  /** 형식은 맞지만 인프라가 거부하는 자격 증명 */
  badCredentials: unknown;
  /** 매핑 옵션 입력 (기본: 빈 객체) */
  mappingOptions?: unknown;
}

/**
 * 모든 제공자가 통과해야 하는 계약 테스트 (PRD 8.1). 실제 인프라 대신 녹화한 응답이나
 * 가짜 서버로 setup을 만든다. setup은 테스트마다 새로 부른다.
 */
export function describeProviderContract(
  name: string,
  setup: () => ContractSetup | Promise<ContractSetup>,
) {
  describe(`${name} 제공자 계약`, () => {
    const want = (key: string, value: string, buildTime = false) => ({
      key,
      value,
      buildTime,
      multiline: value.includes('\n'),
    });

    it('연결 설정을 검증한다', async () => {
      const { provider, connection, invalidConnection } = await setup();
      expect(() => provider.parseConnection(connection)).not.toThrow();
      expect(() => provider.parseConnection(invalidConnection)).toThrow(InvalidTargetConfigError);
    });

    it('맞는 자격 증명이면 연결을 확인하고, 틀리면 TargetAuthError다', async () => {
      const { provider, connection, badCredentials } = await setup();
      await expect(
        provider.testConnection(provider.parseConnection(connection)),
      ).resolves.toBeUndefined();
      await expect(
        provider.testConnection(provider.parseConnection(badCredentials)),
      ).rejects.toThrow(TargetAuthError);
    });

    it('리소스 목록에 대상 리소스가 있다', async () => {
      const { provider, connection, resourceId } = await setup();
      const resources = await provider.listResources(provider.parseConnection(connection));
      expect(resources.map((resource) => resource.id)).toContain(resourceId);
    });

    it('계획을 반영하면 추가·변경·삭제가 원격에 남는다', async () => {
      const { provider, connection, resourceId, mappingOptions } = await setup();
      const conn = provider.parseConnection(connection);
      const options = provider.parseMappingOptions(mappingOptions ?? {});

      await provider.applyPlan(
        conn,
        resourceId,
        {
          add: [want('A', '1'), want('B', 'b', true), want('GONE', 'x')],
          change: [],
          remove: [],
          unchanged: [],
        },
        options,
      );
      await provider.applyPlan(
        conn,
        resourceId,
        {
          add: [],
          change: [want('A', '2')],
          remove: provider.capabilities.deleteKeys ? ['GONE'] : [],
          unchanged: [],
        },
        options,
      );

      const remote = await provider.readVariables(conn, resourceId);
      const byKey = new Map(remote.map((variable) => [variable.key, variable]));
      expect([...byKey.keys()].sort()).toEqual(
        provider.capabilities.deleteKeys ? ['A', 'B'] : ['A', 'B', 'GONE'],
      );
      if (provider.capabilities.readValues) {
        expect(byKey.get('A')?.value).toBe('2');
        expect(byKey.get('B')?.value).toBe('b');
      }
      if (provider.capabilities.buildTimeFlag) {
        expect(byKey.get('B')?.buildTime).toBe(true);
        expect(byKey.get('A')?.buildTime).toBe(false);
      }
    });

    it('지원한다고 밝힌 반영 후 동작을 실행할 수 있다', async () => {
      const { provider, connection, resourceId } = await setup();
      const conn = provider.parseConnection(connection);
      for (const action of provider.capabilities.actions) {
        await expect(provider.runAction?.(conn, resourceId, action)).resolves.toBeDefined();
      }
    });
  });
}
