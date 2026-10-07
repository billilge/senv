import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // prisma generate는 DB 주소가 없어도 동작해야 해서 빈 값을 허용한다. migrate는 DATABASE_URL이 필요하다
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
