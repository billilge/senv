import { Prisma } from '../generated/prisma/client.js';

/** 유니크 제약 위반 (같은 이름이 이미 있음) */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
