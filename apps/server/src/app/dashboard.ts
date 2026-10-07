import { basename, sep } from 'node:path';
import type { ServeStaticModuleOptions } from '@nestjs/serve-static';

/** 서버가 직접 처리하는 경로. 이 경로는 index.html로 돌리지 않는다 (없는 /assets 파일도 404) */
const SERVER_PATHS = /^\/(?:api|auth|assets)(?:\/|$)|^\/healthz\/?$/;

/** 대시보드 빌드(Vite)를 같은 도메인에서 제공한다 (PRD 4.2). 그 밖의 경로는 SPA라서 index.html을 준다 */
export function dashboardStaticOptions(rootPath: string): ServeStaticModuleOptions {
  return {
    rootPath,
    exclude: SERVER_PATHS,
    serveStaticOptions: {
      setHeaders: (res: { setHeader(name: string, value: string): void }, path: string) => {
        if (basename(path) === 'index.html') {
          // 새로 배포하면 바로 새 빌드를 받도록 매번 확인한다
          res.setHeader('Cache-Control', 'no-cache');
        } else if (path.includes(`${sep}assets${sep}`)) {
          // Vite가 파일 이름에 내용 해시를 넣으므로 바뀌지 않는다
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    },
  };
}
