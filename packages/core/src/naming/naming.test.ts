import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_NAMES, isEnvironmentName, isValidProjectName } from './index';

describe('환경 이름', () => {
  it('local, development, production 세 개로 고정이다', () => {
    expect(ENVIRONMENT_NAMES).toEqual(['local', 'development', 'production']);
  });

  it.each(['local', 'development', 'production'])('%s 는 환경 이름이다', (name) => {
    expect(isEnvironmentName(name)).toBe(true);
  });

  it.each(['staging', 'Production', 'prod', ''])('"%s" 는 환경 이름이 아니다', (name) => {
    expect(isEnvironmentName(name)).toBe(false);
  });
});

describe('isValidProjectName', () => {
  it.each(['server', 'web-admin', 'app2', 'a', 'x'.repeat(32)])('%s 는 허용한다', (name) => {
    expect(isValidProjectName(name)).toBe(true);
  });

  it.each([
    ['빈 문자열', ''],
    ['대문자', 'Server'],
    ['밑줄', 'web_admin'],
    ['하이픈으로 시작', '-web'],
    ['하이픈으로 끝남', 'web-'],
    ['공백', 'web admin'],
    ['한글', '서버'],
    ['슬래시', 'web/admin'],
    ['33자', 'x'.repeat(33)],
  ])('%s(%s)는 거부한다', (_label, name) => {
    expect(isValidProjectName(name)).toBe(false);
  });
});
