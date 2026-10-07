import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * git이 이 파일을 무시하는지. .gitignore 패턴 해석은 git에 맡긴다.
 * git 저장소가 아니면(또는 git이 없으면) .gitignore에 같은 줄이 있는지로 판단한다.
 */
export async function isGitIgnored(root: string, file: string): Promise<boolean> {
  const exitCode = await new Promise<number | 'unavailable'>((resolve) => {
    execFile('git', ['check-ignore', '-q', '--', file], { cwd: root }, (error) => {
      if (!error) return resolve(0);
      const code = (error as NodeJS.ErrnoException & { code?: unknown }).code;
      resolve(typeof code === 'number' ? code : 'unavailable');
    });
  });
  if (exitCode === 0) return true;
  if (exitCode === 1) return false;
  // 128: git 저장소가 아님, 'unavailable': git이 없음
  return (await readGitignore(root)).some((line) => line === file || line === `/${file}`);
}

/** 무시되지 않으면 .gitignore 끝에 추가한다. 추가했으면 true */
export async function ensureGitIgnored(root: string, file: string): Promise<boolean> {
  if (await isGitIgnored(root, file)) return false;
  const path = join(root, '.gitignore');
  const current = await readFile(path, 'utf8').catch(() => '');
  const separator = current === '' ? '' : current.endsWith('\n') ? '\n' : '\n\n';
  await writeFile(
    path,
    `${current}${separator}# senv가 만드는 값 파일 (커밋하지 않는다)\n/${file}\n`,
  );
  return true;
}

async function readGitignore(root: string): Promise<string[]> {
  const text = await readFile(join(root, '.gitignore'), 'utf8').catch(() => '');
  return text.split(/\r?\n/).map((line) => line.trim());
}
