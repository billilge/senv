import { TargetUnavailableError } from '@senv/core';
import { describe, expect, it } from 'vitest';
import { describeProviderContract, MemoryTargetProvider } from './index';

describeProviderContract('MemoryTargetProvider', () => ({
  provider: new MemoryTargetProvider({ resources: [{ id: 'app-1', name: 'stream-api' }] }),
  connection: { token: 'test-token' },
  resourceId: 'app-1',
  invalidConnection: {},
  badCredentials: { token: 'wrong' },
}));

const connection = { token: 'test-token' };
const want = (key: string, value: string, buildTime = false) => ({
  key,
  value,
  buildTime,
  multiline: false,
});

describe('MemoryTargetProvider', () => {
  it('반영한 계획과 실행한 동작을 기록해 테스트에서 확인할 수 있다', async () => {
    const provider = new MemoryTargetProvider({ resources: [{ id: 'app-1', name: 'api' }] });
    provider.seed('app-1', { OLD: 'x' });

    await provider.applyPlan(
      connection,
      'app-1',
      { add: [want('A', '1', true)], change: [], remove: ['OLD'], unchanged: [] },
      {},
    );
    await provider.runAction(connection, 'app-1', 'redeploy');

    expect(provider.variablesOf('app-1')).toEqual({ A: '1' });
    expect(provider.actions).toEqual([{ resourceId: 'app-1', action: 'redeploy' }]);
  });

  it('값을 읽을 수 없는 제공자를 흉내 내면 값 대신 null을 준다', async () => {
    const provider = new MemoryTargetProvider({
      resources: [{ id: 'app-1', name: 'api' }],
      capabilities: { readValues: false },
    });
    provider.seed('app-1', { A: '1' });
    expect(await provider.readVariables(connection, 'app-1')).toEqual([
      { key: 'A', value: null, buildTime: false },
    ]);
  });

  it('다음 호출을 실패하게 할 수 있다 (재시도 테스트용)', async () => {
    const provider = new MemoryTargetProvider({ resources: [{ id: 'app-1', name: 'api' }] });
    provider.failNext(new TargetUnavailableError('잠시 안 됨'));
    await expect(provider.listResources(connection)).rejects.toThrow(TargetUnavailableError);
    await expect(provider.listResources(connection)).resolves.toHaveLength(1);
  });

  it('지원하지 않는 동작은 실패한다', async () => {
    const provider = new MemoryTargetProvider({
      resources: [{ id: 'app-1', name: 'api' }],
      capabilities: { actions: ['redeploy'] },
    });
    await expect(provider.runAction(connection, 'app-1', 'restart')).rejects.toThrow();
  });
});
