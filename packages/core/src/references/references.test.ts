// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY} 참조 문법을 글자 그대로 검사한다
import { describe, expect, it } from 'vitest';
import { resolveSharedReferences } from './index';

describe('resolveSharedReferences', () => {
  const shared = { API_HOST: 'api.stream.dev', API_PORT: '443', EMPTY: '' };

  it('참조가 없으면 값을 그대로 돌려준다', () => {
    expect(resolveSharedReferences({ A: 'plain' }, shared)).toEqual({
      values: { A: 'plain' },
      issues: [],
    });
  });

  it('${shared.KEY}를 공유 그룹의 값으로 바꾼다', () => {
    const result = resolveSharedReferences({ HOST: '${shared.API_HOST}' }, shared);
    expect(result.values).toEqual({ HOST: 'api.stream.dev' });
    expect(result.issues).toEqual([]);
  });

  it('한 값 안의 여러 참조와 반복된 참조를 모두 바꾼다', () => {
    const result = resolveSharedReferences(
      { URL: 'https://${shared.API_HOST}:${shared.API_PORT}/v1?h=${shared.API_HOST}' },
      shared,
    );
    expect(result.values.URL).toBe('https://api.stream.dev:443/v1?h=api.stream.dev');
  });

  it('빈 공유 값도 그대로 넣는다', () => {
    expect(resolveSharedReferences({ A: 'x${shared.EMPTY}y' }, shared).values.A).toBe('xy');
  });

  it('공유 값에 $& 같은 특수 문자가 있어도 글자 그대로 넣는다', () => {
    const result = resolveSharedReferences({ A: '${shared.SECRET}' }, { SECRET: 'p$&ss$1' });
    expect(result.values.A).toBe('p$&ss$1');
  });

  it('shared. 로 시작하지 않는 ${...} 와 $VAR 는 건드리지 않는다', () => {
    const values = { A: '${HOME}/x', B: '$PATH', C: '${other.API_HOST}' };
    expect(resolveSharedReferences(values, shared)).toEqual({ values, issues: [] });
  });

  it('공유 값 안의 참조는 다시 해석하지 않는다 (한 번만 바꾼다)', () => {
    const result = resolveSharedReferences(
      { A: '${shared.OUTER}' },
      { OUTER: '${shared.INNER}', INNER: 'inner' },
    );
    expect(result.values.A).toBe('${shared.INNER}');
  });

  it('공유 그룹에 없는 키를 참조하면 missing_reference 이슈를 내고 참조는 그대로 둔다', () => {
    const result = resolveSharedReferences({ A: 'x-${shared.NOPE}' }, shared);
    expect(result.values.A).toBe('x-${shared.NOPE}');
    expect(result.issues).toEqual([
      { code: 'missing_reference', key: 'A', reference: '${shared.NOPE}' },
    ]);
  });

  it('키 이름 규칙에 맞지 않는 참조는 invalid_reference 이슈다', () => {
    const result = resolveSharedReferences({ A: '${shared.api_host}', B: '${shared.}' }, shared);
    expect(result.issues).toEqual([
      { code: 'invalid_reference', key: 'A', reference: '${shared.api_host}' },
      { code: 'invalid_reference', key: 'B', reference: '${shared.}' },
    ]);
  });

  it('이슈는 키 이름 순, 같은 키 안에서는 나온 순서대로 정렬한다', () => {
    const result = resolveSharedReferences(
      { Z: '${shared.MISSING_Z}', A: '${shared.SECOND} ${shared.first}' },
      shared,
    );
    expect(result.issues.map((issue) => [issue.key, issue.reference])).toEqual([
      ['A', '${shared.SECOND}'],
      ['A', '${shared.first}'],
      ['Z', '${shared.MISSING_Z}'],
    ]);
  });

  it('넘겨받은 객체를 바꾸지 않는다', () => {
    const values = { HOST: '${shared.API_HOST}' };
    resolveSharedReferences(values, shared);
    expect(values).toEqual({ HOST: '${shared.API_HOST}' });
  });
});
