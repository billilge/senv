import { describe, expect, it } from 'vitest';
import { DotenvParseError, parseDotenv } from './index';

describe('parseDotenv', () => {
  describe('기본 문법', () => {
    it('KEY=value 줄을 읽는다', () => {
      expect(parseDotenv('A=1\nB=hello')).toEqual({ A: '1', B: 'hello' });
    });

    it('빈 줄과 # 주석 줄은 건너뛴다', () => {
      expect(parseDotenv('# 주석\n\nA=1\n   \n  # 들여쓴 주석\nB=2\n')).toEqual({ A: '1', B: '2' });
    });

    it('export 접두사를 허용한다', () => {
      expect(parseDotenv('export A=1\nexport  B=2')).toEqual({ A: '1', B: '2' });
    });

    it('= 양옆 공백과 따옴표 없는 값의 앞뒤 공백을 없앤다', () => {
      expect(parseDotenv('A = hello world  ')).toEqual({ A: 'hello world' });
    });

    it('빈 값은 빈 문자열이다', () => {
      expect(parseDotenv('A=\nB=   ')).toEqual({ A: '', B: '' });
    });

    it('값 안의 = 는 그대로 둔다', () => {
      expect(parseDotenv('URL=postgres://u:p@h/db?a=b')).toEqual({
        URL: 'postgres://u:p@h/db?a=b',
      });
    });

    it('CRLF 줄바꿈도 읽는다', () => {
      expect(parseDotenv('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' });
    });

    it('같은 키가 다시 나오면 뒤의 값을 쓴다', () => {
      expect(parseDotenv('A=1\nA=2')).toEqual({ A: '2' });
    });

    it('$ 는 치환하지 않고 그대로 둔다', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: .env 안의 ${...}를 글자 그대로 검사한다
      expect(parseDotenv('A=${B}\nC="$HOME/x"')).toEqual({ A: '${B}', C: '$HOME/x' });
    });
  });

  describe('주석', () => {
    it('따옴표 없는 값에서 공백 뒤의 # 부터는 주석이다', () => {
      expect(parseDotenv('A=value # 설명')).toEqual({ A: 'value' });
    });

    it('공백 없이 붙은 # 은 값의 일부다', () => {
      expect(parseDotenv('A=val#ue')).toEqual({ A: 'val#ue' });
    });

    it('닫는 따옴표 뒤의 주석은 무시한다', () => {
      expect(parseDotenv('A="x # y" # 설명')).toEqual({ A: 'x # y' });
    });
  });

  describe('작은따옴표', () => {
    it('내용을 그대로 읽는다 (이스케이프를 해석하지 않는다)', () => {
      expect(parseDotenv("A='a\\nb # c'")).toEqual({ A: 'a\\nb # c' });
    });

    it('여러 줄에 걸칠 수 있다', () => {
      expect(parseDotenv("A='first\nsecond'\nB=2")).toEqual({ A: 'first\nsecond', B: '2' });
    });
  });

  describe('큰따옴표', () => {
    it('\\n, \\r, \\", \\\\ 이스케이프를 해석한다', () => {
      expect(parseDotenv('A="l1\\nl2\\r \\"q\\" \\\\"')).toEqual({ A: 'l1\nl2\r "q" \\' });
    });

    it('모르는 이스케이프는 역슬래시까지 그대로 둔다', () => {
      expect(parseDotenv('A="\\$x"')).toEqual({ A: '\\$x' });
    });

    it('여러 줄에 걸칠 수 있다', () => {
      expect(parseDotenv('KEY="-----BEGIN-----\nabc\n-----END-----"\nB=2')).toEqual({
        KEY: '-----BEGIN-----\nabc\n-----END-----',
        B: '2',
      });
    });

    it('따옴표 안의 앞뒤 공백은 유지한다', () => {
      expect(parseDotenv('A="  padded  "')).toEqual({ A: '  padded  ' });
    });
  });

  describe('오류', () => {
    it('= 가 없는 줄은 줄 번호와 함께 DotenvParseError를 던진다', () => {
      expectParseError('A=1\nnot-a-pair', 2);
    });

    it('키 이름이 숫자로 시작하면 오류다', () => {
      expectParseError('1A=x', 1);
    });

    it('키 이름에 - 가 있으면 오류다', () => {
      expectParseError('A=1\n\nMY-KEY=x', 3);
    });

    it('닫히지 않은 따옴표는 따옴표가 시작된 줄 번호로 오류를 낸다', () => {
      expectParseError('A=1\nB="open\nC=2', 2);
    });

    it('닫는 따옴표 뒤에 주석이 아닌 글자가 있으면 오류다', () => {
      expectParseError('A="x"y', 1);
    });
  });
});

function expectParseError(text: string, line: number) {
  let error: unknown;
  try {
    parseDotenv(text);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(DotenvParseError);
  expect((error as DotenvParseError).line).toBe(line);
}
