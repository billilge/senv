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
    exposure: z.object({
      exposedSecrets: z
        .array(z.string())
        .describe('secret인데 공개 접두사가 붙은 키. pull·run을 막는다'),
      unregistered: z
        .array(z.string())
        .describe('스키마에 없는데 공개 접두사가 붙은 키. 경고만 한다'),
    }),
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

export const versionInfoSchema = z
  .object({
    version: z.number().int(),
    message: z.string(),
    createdAt: isoDateTime,
    author: z.object({
      id: z.string(),
      login: z.string().nullable().describe('토큰이 게시했거나 사용자가 지워졌으면 null'),
    }),
  })
  .meta({ id: 'VersionInfo' });

export const versionListSchema = z
  .object({ versions: z.array(versionInfoSchema) })
  .meta({ id: 'VersionList' });

export const keySchemaSchema = z
  .object({
    key: z.string(),
    type: z.enum(['string', 'url', 'number', 'boolean', 'json']),
    visibility: z.enum(['secret', 'public']),
    required: z.boolean(),
    optionalIn: z.array(z.enum(ENVIRONMENT_NAMES)),
    buildTime: z.boolean(),
    description: z.string(),
  })
  .meta({ id: 'KeySchema' });

export const keySchemaListSchema = z
  .object({ publicPrefixes: z.array(z.string()), keys: z.array(keySchemaSchema) })
  .meta({ id: 'KeySchemaList' });

export const publicPrefixesSchema = z
  .object({ publicPrefixes: z.array(z.string()) })
  .meta({ id: 'PublicPrefixes' });

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
