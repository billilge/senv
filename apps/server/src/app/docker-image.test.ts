import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../../..');

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
}

const readPackage = (dir: string): PackageJson =>
  JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));

/** 워크스페이스 패키지 이름 → 저장소 기준 폴더 */
function workspaceDirs(): Map<string, string> {
  const dirs = new Map<string, string>();
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${group}/${entry.name}`;
      dirs.set(readPackage(dir).name, dir);
    }
  }
  return dirs;
}

/** 서버가 실행 중에 불러오는 워크스페이스 패키지 (dependencies를 끝까지 따라간다) */
function runtimeWorkspacePackages(): string[] {
  const dirs = workspaceDirs();
  const found = new Set<string>();
  const visit = (dir: string) => {
    for (const [name, range] of Object.entries(readPackage(dir).dependencies ?? {})) {
      const depDir = dirs.get(name);
      if (!range.startsWith('workspace:') || !depDir || found.has(depDir)) continue;
      found.add(depDir);
      visit(depDir);
    }
  };
  visit('apps/server');
  return [...found].sort();
}

describe('배포 이미지 (Dockerfile)', () => {
  it('서버가 실행 중에 불러오는 워크스페이스 패키지의 빌드 결과를 모두 담는다', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    const packages = runtimeWorkspacePackages();

    expect(packages).toContain('packages/core');
    const missing = packages.filter(
      (dir) => !dockerfile.includes(`COPY --from=build /app/${dir}/dist ./${dir}/dist`),
    );
    expect(missing).toEqual([]);
  });
});
