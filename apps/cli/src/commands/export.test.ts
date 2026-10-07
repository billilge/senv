import { describe, expect, it } from 'vitest';
import { createTestContext, FakeApi, signedIn } from '../testing/fake-api.js';
import { delivered, webRepo } from '../testing/repo.js';
import { exportValues } from './export.js';

const VALUES = { B: "it's", A: 'line1\nline2' };

async function exported(format: 'dotenv' | 'json' | 'shell' | 'yaml') {
  const root = await webRepo();
  const api = new FakeApi().reply(
    'GET',
    '/api/v1/projects/web/envs/local/variables',
    delivered('local', VALUES),
  );
  const test = await createTestContext(api, { cwd: root });
  await signedIn(test.credentials);
  await exportValues(test.context, { format });
  return test.logs.result.join('');
}

describe('senv export', () => {
  it('json: 키 이름 순 객체', async () => {
    expect(JSON.parse(await exported('json'))).toEqual({ A: 'line1\nline2', B: "it's" });
  });

  it('shell: export 문 (작은따옴표 안전하게)', async () => {
    expect(await exported('shell')).toBe("export A='line1\nline2'\nexport B='it'\\''s'");
  });

  it('yaml: 따옴표로 감싼 문자열', async () => {
    expect(await exported('yaml')).toBe('A: "line1\\nline2"\nB: "it\'s"');
  });

  it('dotenv: 머리글 없이', async () => {
    const text = await exported('dotenv');
    expect(text.startsWith('#')).toBe(false);
    expect(text).toContain('A="line1\\nline2"');
  });
});
