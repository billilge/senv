import { describe, expect, it } from 'vitest';
import { checkClientExposure, type VisibilityEntry } from './index';

describe('checkClientExposure', () => {
  const schema: VisibilityEntry[] = [
    { key: 'VITE_API_URL', visibility: 'public' },
    { key: 'VITE_STRIPE_SECRET', visibility: 'secret' },
    { key: 'EXPO_PUBLIC_ADMIN_TOKEN', visibility: 'secret' },
    { key: 'SENTRY_AUTH_TOKEN', visibility: 'secret' },
  ];
  const clean = { exposedSecrets: [], unregistered: [] };

  it('공개 접두사가 없는 프로젝트(server)는 아무것도 걸지 않는다', () => {
    expect(checkClientExposure(['VITE_STRIPE_SECRET', 'VITE_NEW'], schema, [])).toEqual(clean);
  });

  it('secret 변수가 공개 접두사로 시작하면 exposedSecrets로 막는다', () => {
    expect(checkClientExposure(['VITE_STRIPE_SECRET'], schema, ['VITE_'])).toEqual({
      exposedSecrets: ['VITE_STRIPE_SECRET'],
      unregistered: [],
    });
  });

  it('public 변수는 공개 접두사로 시작해도 괜찮다', () => {
    expect(checkClientExposure(['VITE_API_URL'], schema, ['VITE_'])).toEqual(clean);
  });

  it('secret 변수라도 공개 접두사가 없으면 괜찮다 (빌드할 때만 쓰는 값)', () => {
    expect(checkClientExposure(['SENTRY_AUTH_TOKEN'], schema, ['VITE_'])).toEqual(clean);
  });

  it('스키마에 없는 키가 공개 접두사로 시작하면 막지 않고 unregistered 경고로 알린다', () => {
    expect(checkClientExposure(['VITE_UNREGISTERED'], schema, ['VITE_'])).toEqual({
      exposedSecrets: [],
      unregistered: ['VITE_UNREGISTERED'],
    });
  });

  it('스키마에 없어도 공개 접두사가 없으면 경고하지 않는다', () => {
    expect(checkClientExposure(['UNKNOWN_BUILD_KEY'], schema, ['VITE_'])).toEqual(clean);
  });

  it('받는 키 목록에 없는 스키마 항목은 검사하지 않는다', () => {
    expect(checkClientExposure([], schema, ['VITE_', 'EXPO_PUBLIC_'])).toEqual(clean);
  });

  it('여러 접두사를 함께 검사하고, 두 목록 모두 키 이름 순이다', () => {
    const keys = [
      'VITE_STRIPE_SECRET',
      'VITE_ZZZ_NEW',
      'EXPO_PUBLIC_ADMIN_TOKEN',
      'EXPO_PUBLIC_NEW',
      'VITE_API_URL',
    ];
    expect(checkClientExposure(keys, schema, ['VITE_', 'EXPO_PUBLIC_'])).toEqual({
      exposedSecrets: ['EXPO_PUBLIC_ADMIN_TOKEN', 'VITE_STRIPE_SECRET'],
      unregistered: ['EXPO_PUBLIC_NEW', 'VITE_ZZZ_NEW'],
    });
  });
});
