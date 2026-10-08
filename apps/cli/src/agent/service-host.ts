import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import type { ServiceHost } from './service.js';

/** 실제 OS의 서비스 호스트. 각 동작은 service.test.ts에서 가짜로 검사했고 여기서는 조립만 한다 */
export function createRealServiceHost(): ServiceHost {
  return {
    platform: process.platform,
    home: homedir(),
    uid: process.getuid?.() ?? 0,
    execPath: process.execPath,
    // 전역 설치의 bin 링크가 아니라 실제 dist/cli.js를 가리킨다
    script: realpathSync(process.argv[1] ?? ''),
    env: process.env,
    exec: (command, args) =>
      new Promise((resolve) => {
        execFile(command, args, (error, stdout, stderr) => {
          const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
          resolve({ code, output: `${stdout}${stderr}` });
        });
      }),
  };
}
