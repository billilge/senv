import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';

/** `mysql://user:pass@host:port/db` 주소로 Prisma 클라이언트를 만든다 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const url = new URL(databaseUrl);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    // MySQL 8 기본 인증(caching_sha2_password)은 TLS 없이 붙을 때 공개키 조회가 필요하다.
    // 운영에서는 Coolify 내부 네트워크로만 접속한다
    allowPublicKeyRetrieval: true,
    connectionLimit: 10,
  });
  return new PrismaClient({ adapter });
}
