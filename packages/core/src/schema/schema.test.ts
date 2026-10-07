import { describe, expect, it } from 'vitest';
import { isValidKeyName, isValidValue, type KeySchema, validateEnvironment } from './index';

describe('isValidKeyName', () => {
  it.each(['DATABASE_URL', 'API_V2', '_INTERNAL', 'A'])('%s 는 허용한다', (key) => {
    expect(isValidKeyName(key)).toBe(true);
  });

  it.each([
    ['소문자', 'database_url'],
    ['숫자로 시작', '2FA_SECRET'],
    ['하이픈', 'MY-KEY'],
    ['점', 'APP.NAME'],
    ['공백', 'MY KEY'],
    ['빈 문자열', ''],
  ])('%s(%s)는 거부한다', (_label, key) => {
    expect(isValidKeyName(key)).toBe(false);
  });
});

describe('isValidValue', () => {
  it('string은 빈 문자열을 포함해 무엇이든 허용한다', () => {
    expect(isValidValue('string', '')).toBe(true);
    expect(isValidValue('string', 'anything goes # $ "')).toBe(true);
  });

  it.each(['https://api.example.com/v1', 'postgres://u:p@db:5432/app', 'redis://localhost:6379'])(
    'url: %s 는 허용한다',
    (value) => {
      expect(isValidValue('url', value)).toBe(true);
    },
  );

  it.each(['localhost:3000', 'example.com', 'not a url', ''])('url: %s 는 거부한다', (value) => {
    expect(isValidValue('url', value)).toBe(false);
  });

  it.each(['0', '42', '-1', '3.14'])('number: %s 는 허용한다', (value) => {
    expect(isValidValue('number', value)).toBe(true);
  });

  it.each(['', ' 1', '1e3', 'abc', '1,000', '1.'])('number: "%s" 는 거부한다', (value) => {
    expect(isValidValue('number', value)).toBe(false);
  });

  it.each(['true', 'false'])('boolean: %s 는 허용한다', (value) => {
    expect(isValidValue('boolean', value)).toBe(true);
  });

  it.each(['TRUE', '1', 'yes', ''])('boolean: "%s" 는 거부한다', (value) => {
    expect(isValidValue('boolean', value)).toBe(false);
  });

  it.each(['{"a":1}', '[1,2]', '"text"', 'null'])('json: %s 는 허용한다', (value) => {
    expect(isValidValue('json', value)).toBe(true);
  });

  it.each(['{a:1}', "{'a':1}", ''])('json: "%s" 는 거부한다', (value) => {
    expect(isValidValue('json', value)).toBe(false);
  });
});

describe('validateEnvironment', () => {
  const schema: KeySchema[] = [
    { key: 'DATABASE_URL', type: 'url', required: true },
    { key: 'PORT', type: 'number', required: false },
    { key: 'SENTRY_DSN', type: 'url', required: true, optionalIn: ['development'] },
  ];

  it('스키마에 맞으면 문제가 없다', () => {
    const values = {
      DATABASE_URL: 'postgres://db/app',
      PORT: '3000',
      SENTRY_DSN: 'https://k@sentry.io/1',
    };
    expect(validateEnvironment(schema, values, 'production')).toEqual([]);
  });

  it('필수 키가 없으면 missing_required 오류다', () => {
    const values = { SENTRY_DSN: 'https://k@sentry.io/1' };
    expect(validateEnvironment(schema, values, 'production')).toEqual([
      { code: 'missing_required', severity: 'error', key: 'DATABASE_URL' },
    ]);
  });

  it('필수 키의 값이 빈 문자열이어도 missing_required 오류다', () => {
    const values = { DATABASE_URL: '', SENTRY_DSN: 'https://k@sentry.io/1' };
    expect(validateEnvironment(schema, values, 'production')).toEqual([
      { code: 'missing_required', severity: 'error', key: 'DATABASE_URL' },
    ]);
  });

  it('optionalIn에 들어 있는 환경에서는 필수 키가 없어도 된다', () => {
    const values = { DATABASE_URL: 'postgres://db/app' };
    expect(validateEnvironment(schema, values, 'development')).toEqual([]);
    expect(validateEnvironment(schema, values, 'staging')).toEqual([
      { code: 'missing_required', severity: 'error', key: 'SENTRY_DSN' },
    ]);
  });

  it('타입이 맞지 않으면 invalid_type 오류다', () => {
    const values = { DATABASE_URL: 'postgres://db/app', PORT: 'eighty', SENTRY_DSN: 'nope' };
    expect(validateEnvironment(schema, values, 'production')).toEqual([
      { code: 'invalid_type', severity: 'error', key: 'PORT', expected: 'number' },
      { code: 'invalid_type', severity: 'error', key: 'SENTRY_DSN', expected: 'url' },
    ]);
  });

  it('필수가 아닌 키의 빈 값은 타입을 검사하지 않는다', () => {
    const values = { DATABASE_URL: 'postgres://db/app', PORT: '' };
    expect(validateEnvironment(schema, values, 'development')).toEqual([]);
  });

  it('스키마에 없는 키는 unknown_key 경고다', () => {
    const values = { DATABASE_URL: 'postgres://db/app', LEGACY_FLAG: 'on' };
    expect(validateEnvironment(schema, values, 'development')).toEqual([
      { code: 'unknown_key', severity: 'warning', key: 'LEGACY_FLAG' },
    ]);
  });

  it('문제 목록은 키 이름 순으로 정렬한다', () => {
    const values = { ZETA: 'x', PORT: 'eighty', ALPHA: 'y' };
    expect(validateEnvironment(schema, values, 'development').map((issue) => issue.key)).toEqual([
      'ALPHA',
      'DATABASE_URL',
      'PORT',
      'ZETA',
    ]);
  });
});
