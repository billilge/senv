import type { PrismaClient } from '../generated/prisma/client.js';

let sequence = 0;

/** 테스트용 사용자를 DB에 바로 만든다 */
export async function createTestUser(
  prisma: PrismaClient,
  overrides: Partial<{
    login: string;
    role: 'admin' | 'member';
    status: 'pending' | 'active' | 'disabled';
  }> = {},
) {
  sequence++;
  return prisma.user.create({
    data: {
      githubId: String(900_000 + sequence),
      login: overrides.login ?? `user-${sequence}`,
      role: overrides.role ?? 'member',
      status: overrides.status ?? 'active',
    },
  });
}
