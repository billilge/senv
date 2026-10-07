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

export const projectSummarySchema = z
  .object({
    environments: z.array(
      z.object({
        env: z.enum(ENVIRONMENT_NAMES),
        version: z.number().int(),
        publishedAt: isoDateTime.nullable(),
      }),
    ),
    missing: z.number().int().describe('키 × 환경 매트릭스에서 값이 없는 칸 수'),
    missingRequired: z.number().int().describe('그중 필수 키의 칸 수'),
  })
  .meta({ id: 'ProjectSummary' });

export const projectListSchema = z
  .object({
    projects: z.array(
      projectSchema
        .extend({
          summary: projectSummarySchema.optional().describe('include=summary일 때만 담는다'),
        })
        .meta({ id: 'ProjectListItem' }),
    ),
  })
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

export const roleAssignmentSchema = z
  .object({
    login: z.string().describe('GitHub 사용자명 (소문자)'),
    role: z.enum(['admin', 'member']),
    createdAt: isoDateTime,
  })
  .meta({ id: 'RoleAssignment' });

export const roleAssignmentListSchema = z
  .object({ assignments: z.array(roleAssignmentSchema) })
  .meta({ id: 'RoleAssignmentList' });

const fieldSpecSchema = z.object({
  name: z.string(),
  label: z.string(),
  kind: z.enum(['text', 'url', 'secret', 'boolean']),
  required: z.boolean().optional(),
  description: z.string().optional(),
});

export const targetProviderSchema = z
  .object({
    type: z.string(),
    displayName: z.string(),
    capabilities: z.object({
      readValues: z.boolean(),
      deleteKeys: z.boolean(),
      actions: z.array(z.enum(['restart', 'redeploy'])),
      buildTimeFlag: z.boolean(),
    }),
    connectionFields: z.array(fieldSpecSchema),
    mappingOptionFields: z.array(fieldSpecSchema),
  })
  .meta({ id: 'TargetProvider' });

export const targetProviderListSchema = z
  .object({ providers: z.array(targetProviderSchema) })
  .meta({ id: 'TargetProviderList' });

export const targetConnectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    config: z.record(z.string(), z.unknown()).describe('비밀 필드를 뺀 설정'),
    mappingCount: z.number().int(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .meta({ id: 'TargetConnection' });

export const targetConnectionListSchema = z
  .object({ connections: z.array(targetConnectionSchema) })
  .meta({ id: 'TargetConnectionList' });

export const targetResourceListSchema = z
  .object({
    resources: z.array(
      z.object({ id: z.string(), name: z.string(), description: z.string().optional() }),
    ),
  })
  .meta({ id: 'TargetResourceList' });

const syncStatusSchema = z.enum(['succeeded', 'skipped', 'failed']);
const syncTriggerSchema = z.enum(['publish', 'manual']);
const targetActionSchema = z.enum(['restart', 'redeploy']);

export const targetMappingSchema = z
  .object({
    id: z.string(),
    project: z.string(),
    env: z.enum(ENVIRONMENT_NAMES),
    connection: z.object({ id: z.string(), name: z.string(), type: z.string() }),
    resourceId: z.string(),
    resourceName: z.string(),
    syncMode: z.enum(['auto', 'manual']),
    afterSync: z.enum(['auto', 'none', 'restart', 'redeploy']),
    unmanaged: z.enum(['keep', 'delete']),
    include: z.array(z.string()),
    exclude: z.array(z.string()),
    options: z.record(z.string(), z.unknown()),
    lastSync: z
      .object({ version: z.number().int(), sharedVersion: z.number().int(), at: isoDateTime })
      .nullable(),
    lastRun: z
      .object({
        status: syncStatusSchema,
        trigger: syncTriggerSchema,
        action: z.string().nullable(),
        error: z.string().nullable(),
        at: isoDateTime,
      })
      .nullable(),
    driftKeys: z.array(z.string()).describe('인프라에서 직접 바뀐 키'),
    driftCheckedAt: isoDateTime.nullable(),
  })
  .meta({ id: 'TargetMapping' });

export const targetMappingListSchema = z
  .object({ mappings: z.array(targetMappingSchema) })
  .meta({ id: 'TargetMappingList' });

export const syncPreviewSchema = z
  .object({
    version: z.number().int(),
    sharedVersion: z.number().int(),
    add: z.array(z.string()),
    change: z.array(z.string()),
    remove: z.array(z.string()),
    unchanged: z.number().int(),
    action: targetActionSchema.nullable(),
  })
  .meta({ id: 'SyncPreview' });

export const syncRunSchema = z
  .object({
    id: z.string(),
    trigger: syncTriggerSchema,
    status: syncStatusSchema,
    version: z.number().int(),
    sharedVersion: z.number().int(),
    changedKeys: z.array(z.string()),
    action: targetActionSchema.nullable(),
    providerRef: z.string().nullable(),
    error: z.string().nullable(),
    attempt: z.number().int(),
    startedAt: isoDateTime,
    finishedAt: isoDateTime,
  })
  .meta({ id: 'SyncRun' });

export const syncRunListSchema = z
  .object({ runs: z.array(syncRunSchema) })
  .meta({ id: 'SyncRunList' });

export const importResultSchema = z
  .object({ version: z.number().int(), keys: z.array(z.string()) })
  .meta({ id: 'ImportResult' });

export const driftResultSchema = z
  .object({ driftKeys: z.array(z.string()) })
  .meta({ id: 'DriftResult' });

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
