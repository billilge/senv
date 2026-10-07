import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MySqlContainer } from '@testcontainers/mysql';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const serverDir = join(root, 'apps/server');

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });

/**
 * 브라우저 E2E 실행기 (결정 57): MySQL(로컬 이미지)·마이그레이션·E2E 서버를 띄우고,
 * 관리자 세션 쿠키를 브라우저 상태로 남긴 뒤 Playwright를 자식 프로세스로 돌린다.
 * Playwright 프로세스가 testcontainers를 불러오지 않게 따로 둔다 (Node 24에서 Playwright 로더와 충돌).
 */
async function main(): Promise<number> {
  // 짧은 이름은 Docker Desktop이 가끔 못 찾아 내려받으려 한다 (외부 접속을 피한다)
  const mysql = await new MySqlContainer('docker.io/library/mysql:8.4')
    .withDatabase('stream_env')
    .withUsername('stream_env')
    .withUserPassword('e2e-password')
    .start();
  const databaseUrl = mysql.getConnectionUri();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  const port = await freePort();
  const server: ChildProcess = spawn('node', ['dist-e2e/testing/browser-server.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DASHBOARD_DIR: join(root, 'apps/dashboard/dist'),
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const ready = await new Promise<{ url: string; sessionToken: string }>((resolve, reject) => {
    let buffer = '';
    server.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const line = buffer.split('\n').find((candidate) => candidate.includes('"ready":true'));
      if (line) resolve(JSON.parse(line));
    });
    server.once('exit', (code) => reject(new Error(`E2E 서버가 끝났습니다 (${code})`)));
  });

  const authDir = join(root, 'e2e/browser/.auth');
  mkdirSync(authDir, { recursive: true });
  writeFileSync(
    join(authDir, 'admin.json'),
    JSON.stringify({
      cookies: [
        {
          name: 'senv_session',
          value: ready.sessionToken,
          domain: 'localhost',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  );
  try {
    const playwright = spawn('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
      cwd: join(root, 'e2e'),
      env: { ...process.env, SENV_E2E_URL: ready.url },
      stdio: 'inherit',
    });
    return await new Promise<number>((resolve) =>
      playwright.once('exit', (code) => resolve(code ?? 1)),
    );
  } finally {
    server.kill('SIGTERM');
    await mysql.stop();
  }
}

process.exit(await main());
