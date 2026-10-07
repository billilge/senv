import { ENVIRONMENT_NAMES } from '@senv/core';
import { z } from 'zod';

/** API 응답 스키마. OpenAPI 문서와 클라이언트 타입이 여기서 나온다 */

const isoDateTime = z.string().describe('ISO 8601 시각');

export const apiErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'ApiError' });

export const healthSchema = z.object({ status: z.literal('ok') }).meta({ id: 'Health' });

export const userSchema = z
  .object({
    id: z.string(),
    githubId: z.string(),
    login: z.string(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    role: z.enum(['admin', 'member']),
    status: z.enum(['pending', 'active', 'disabled']),
  })
  .meta({ id: 'User' });

export const userListSchema = z.object({ users: z.array(userSchema) }).meta({ id: 'UserList' });

export const projectSchema = z
  .object({
    name: z.string(),
    displayName: z.string(),
    kind: z.enum(['app', 'shared']),
    environments: z.array(z.enum(ENVIRONMENT_NAMES)),
  })
  .meta({ id: 'Project' });

export const projectListSchema = z
  .object({ projects: z.array(projectSchema) })
  .meta({ id: 'ProjectList' });

const variablesSchema = z.record(z.string(), z.string());

export const environmentValuesSchema = z
  .object({
    project: z.string(),
    env: z.string(),
    version: z.number().int(),
    variables: variablesSchema,
  })
  .meta({ id: 'EnvironmentValues' });

export const deliveredValuesSchema = z
  .object({
    project: z.string(),
    env: z.string(),
    version: z.number().int(),
    sharedVersion: z.number().int(),
    variables: variablesSchema,
  })
  .meta({ id: 'DeliveredValues' });

export const publishResultSchema = z
  .object({
    version: z.number().int(),
    diff: z.object({
      added: z.array(z.string()),
      removed: z.array(z.string()),
      changed: z.array(z.string()),
      unchanged: z.array(z.string()),
    }),
  })
  .meta({ id: 'PublishResult' });

export const tokenPairSchema = z
  .object({
    accessToken: z.string(),
    accessExpiresAt: isoDateTime,
    refreshToken: z.string(),
    refreshExpiresAt: isoDateTime,
  })
  .meta({ id: 'TokenPair' });

export const deviceAuthorizationSchema = z
  .object({
    deviceCode: z.string(),
    userCode: z.string(),
    verificationUri: z.string(),
    verificationUriComplete: z.string(),
    expiresIn: z.number().int(),
    interval: z.number().int(),
  })
  .meta({ id: 'DeviceAuthorization' });
