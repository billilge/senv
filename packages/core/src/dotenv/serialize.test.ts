import { describe, expect, it } from 'vitest';
import { parseDotenv, serializeDotenv } from './index';

describe('serializeDotenv', () => {
  it('단순한 값은 따옴표 없이 쓰고, 키 순서를 지킨다', () => {
    expect(serializeDotenv({ B: 'abc', A: '1' })).toBe('B=abc\nA=1\n');
  });

  it('빈 값은 KEY= 로 쓴다', () => {
    expect(serializeDotenv({ A: '' })).toBe('A=\n');
  });

  it('값이 없으면 빈 문자열을 돌려준다', () => {
    expect(serializeDotenv({})).toBe('');
  });

  it.each([
    ['공백', 'a b', 'A="a b"'],
    ['앞뒤 공백', ' x ', 'A=" x "'],
    ['#', 'x#y', 'A="x#y"'],
    ['큰따옴표', 'say "hi"', 'A="say \\"hi\\""'],
    ['작은따옴표', "it's", 'A="it\'s"'],
    ['역슬래시', 'C:\\path', 'A="C:\\\\path"'],
    ['탭', 'a\tb', 'A="a\tb"'],
  ])('값에 %s 포함 → 큰따옴표로 감싸고 필요한 글자를 이스케이프한다', (_label, value, line) => {
    expect(serializeDotenv({ A: value })).toBe(`${line}\n`);
  });

  it('줄바꿈은 \\n 으로 이스케이프해 한 줄로 쓴다', () => {
    expect(serializeDotenv({ A: 'l1\nl2\r\nl3' })).toBe('A="l1\\nl2\\r\\nl3"\n');
  });

  it('header를 주면 맨 위에 # 주석으로 쓴다', () => {
    const text = serializeDotenv(
      { A: '1' },
      { header: ['senv: web/development v13', 'generated 2026-10-07T09:00:00Z'] },
    );
    expect(text).toBe('# senv: web/development v13\n# generated 2026-10-07T09:00:00Z\nA=1\n');
  });

  it('쓴 결과를 다시 읽으면 원래 값과 같다', () => {
    const vars = {
      EMPTY: '',
      PLAIN: 'plain',
      SPACES: '  leading and trailing  ',
      EQUALS: 'a=b=c',
      HASH: 'x # y',
      SINGLE: "it's",
      DOUBLE: 'say "hi"',
      BACKSLASH: 'back\\slash\\',
      MULTILINE: '-----BEGIN-----\nabc\r\n-----END-----',
      KOREAN: '한글 값',
      EMOJI: 'rocket 🚀',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: ${...}가 치환되지 않고 그대로 왕복하는지 검사한다
      DOLLAR: '${NOT_EXPANDED}',
      TAB: 'tab\there',
      URL: 'postgres://u:p@h:5432/db?ssl=true',
    };
    expect(parseDotenv(serializeDotenv(vars))).toEqual(vars);
  });
});
