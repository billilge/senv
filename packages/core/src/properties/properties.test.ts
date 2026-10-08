import { describe, expect, it } from 'vitest';
import { PropertiesParseError, parseProperties, serializeProperties } from './index';

describe('serializeProperties', () => {
  it('단순한 값은 그대로 쓰고, 키 순서를 지킨다', () => {
    expect(serializeProperties({ B: 'abc', A: '1' })).toBe('B=abc\nA=1\n');
  });

  it('빈 값은 KEY= 로 쓰고, 값이 없으면 빈 문자열을 돌려준다', () => {
    expect(serializeProperties({ A: '' })).toBe('A=\n');
    expect(serializeProperties({})).toBe('');
  });

  it('header를 주면 맨 위에 # 주석으로 쓴다', () => {
    expect(serializeProperties({ A: '1' }, { header: ['senv: web/local v3 (shared v1)'] })).toBe(
      '# senv: web/local v3 (shared v1)\nA=1\n',
    );
  });

  it.each([
    ['URL의 : = ? &', 'jdbc:mysql://db:3306/app?a=b&c=d', 'jdbc:mysql://db:3306/app?a=b&c=d'],
    ['값 중간의 # !', 'x#y!z', 'x#y!z'],
    ['따옴표', `say "hi" it's`, `say "hi" it's`],
    ['역슬래시', 'C:\\path\\to', 'C:\\\\path\\\\to'],
    ['줄바꿈·CR·탭·폼피드', 'l1\nl2\r\tx\fy', 'l1\\nl2\\r\\tx\\fy'],
    ['다른 제어 문자', 'a\u0001b', 'a\\u0001b'],
    ['맨 앞 공백 (뒤 공백은 그대로)', '  x ', '\\  x '],
    ['한글', '한글', '\\uD55C\\uAE00'],
    ['BMP 밖 글자', '😀', '\\uD83D\\uDE00'],
    ['Spring 자리표시자', '${OTHER}', '${OTHER}'],
  ])('값에 %s → Spring이 같은 값으로 읽도록 쓴다', (_label, value, written) => {
    expect(serializeProperties({ A: value })).toBe(`A=${written}\n`);
  });
});

describe('parseProperties', () => {
  it('serializeProperties로 쓴 값을 그대로 읽는다', () => {
    const vars = {
      URL: 'jdbc:mysql://db:3306/app?a=b',
      PATH_WIN: 'C:\\path',
      MULTI: 'l1\nl2\r\n\tl3',
      LEADING: '  x ',
      KOREAN: '한글 😀',
      CONTROL: 'a\u0001b\u007f',
      EMPTY: '',
      MARKS: '=:#! "\'',
    };
    expect(parseProperties(serializeProperties(vars, { header: ['머리글'] }))).toEqual(vars);
  });

  it('주석(#, !)과 빈 줄을 건너뛰고, 같은 키는 마지막 값을 쓴다', () => {
    expect(parseProperties('# 주석\n! 주석\n\nA=1\n  A=2\r\nB=3')).toEqual({ A: '2', B: '3' });
  });

  it.each([
    ['= 앞뒤 공백', 'A = value', 'value'],
    [': 구분자', 'A:value', 'value'],
    ['공백 구분자', 'A value', 'value'],
    ['공백 뒤 = 구분자', 'A  =  value', 'value'],
    ['구분자 뒤의 두 번째 =는 값', 'A==x', '=x'],
    ['이스케이프한 구분 문자', 'A=a\\=b\\:c\\#d', 'a=b:c#d'],
    ['값 뒤 공백은 남긴다', 'A=x  ', 'x  '],
    ['구분자 없음', 'A', ''],
  ])('%s', (_label, line, value) => {
    expect(parseProperties(line)).toEqual({ A: value });
  });

  it('줄 끝 역슬래시는 다음 줄과 이어 붙이고, 이어진 줄의 앞 공백은 버린다', () => {
    expect(parseProperties('A=first \\\n    second\nB=x\\\\\nC=y')).toEqual({
      A: 'first second',
      B: 'x\\',
      C: 'y',
    });
  });

  it('잘못된 \\u 이스케이프는 줄 번호와 함께 PropertiesParseError다', () => {
    const error = (() => {
      try {
        parseProperties('A=1\nB=\\u12G4');
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(PropertiesParseError);
    expect(error).toMatchObject({ line: 2 });
  });

  it('senv 키 규칙에 맞지 않는 키는 PropertiesParseError다', () => {
    expect(() => parseProperties('spring.datasource.url=x')).toThrow(PropertiesParseError);
  });
});
