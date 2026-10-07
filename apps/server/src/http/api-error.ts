import { HttpException } from '@nestjs/common';
import {
  ChangeSetConflictError,
  InvalidTargetConfigError,
  TargetAuthError,
  TargetNotFoundError,
  TargetUnavailableError,
} from '@senv/core';
import { InvalidRefreshTokenError, RefreshTokenReusedError } from '../auth/api-token-service.js';
import { NotOrgMemberError, UserDisabledError } from '../auth/auth-service.js';
import {
  DeviceApprovalForbiddenError,
  DeviceCodeExpiredError,
  DeviceCodeNotFoundError,
  InvalidDeviceCodeError,
} from '../auth/device-auth-service.js';
import { GitHubAuthError, GitHubUnavailableError } from '../auth/github-client.js';
import { BrokenReferenceError } from '../delivery/delivery-service.js';
import {
  InvalidKeyNameError,
  InvalidPublicPrefixError,
  KeySchemaNotFoundError,
} from '../key-schemas/key-schema-service.js';
import {
  InvalidProjectNameError,
  ProjectNameTakenError,
  ProjectNotFoundError,
  ReservedProjectNameError,
} from '../projects/projects-service.js';
import {
  InvalidEnvironmentError,
  NoChangesError,
  PublishValidationError,
  VersionConflictError,
  VersionNotFoundError,
} from '../publishing/publish-service.js';
import {
  ConnectionInUseError,
  ConnectionNameTakenError,
  ConnectionNotFoundError,
} from '../targets/connections-service.js';
import { UnknownProviderError } from '../targets/target-registry.js';
import {
  AdminRequiredError,
  AssignmentNotFoundError,
  CannotDisableSelfError,
  InvalidGitHubLoginError,
  LastAdminError,
  UserAlreadyExistsError,
  UserNotFoundError,
} from '../users/users-service.js';

/** 모든 API 오류 응답의 형식. code로 분기하고 message는 사람에게 보여준다 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiError {
  status: number;
  body: ApiErrorBody;
}

/** 요청 본문·쿼리·경로 값이 스키마에 맞지 않음 */
export class RequestValidationError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super('요청 형식이 올바르지 않습니다');
    this.name = 'RequestValidationError';
  }
}

/** 상황마다 code가 달라지는 HTTP 오류 (가드, 디바이스 폴링 상태 등) */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiProblem';
  }
}

// biome-ignore lint/suspicious/noExplicitAny: 여러 오류 클래스의 생성자를 한 표에 담는다
type ErrorClass = new (...args: any[]) => Error;

interface Rule {
  type: ErrorClass;
  status: number;
  code: string;
  details?: (error: never) => Record<string, unknown>;
}

const RULES: Rule[] = [
  {
    type: RequestValidationError,
    status: 400,
    code: 'invalid_request',
    details: (e: RequestValidationError) => ({ issues: e.issues }),
  },
  { type: ProjectNotFoundError, status: 404, code: 'project_not_found' },
  { type: InvalidEnvironmentError, status: 400, code: 'invalid_environment' },
  { type: InvalidProjectNameError, status: 422, code: 'invalid_project_name' },
  { type: ReservedProjectNameError, status: 422, code: 'reserved_project_name' },
  { type: ProjectNameTakenError, status: 409, code: 'project_name_taken' },
  {
    type: VersionConflictError,
    status: 409,
    code: 'version_conflict',
    details: (e: VersionConflictError) => ({
      baseVersion: e.baseVersion,
      currentVersion: e.currentVersion,
    }),
  },
  { type: NoChangesError, status: 422, code: 'no_changes' },
  { type: VersionNotFoundError, status: 404, code: 'version_not_found' },
  { type: InvalidKeyNameError, status: 422, code: 'invalid_key_name' },
  { type: KeySchemaNotFoundError, status: 404, code: 'key_schema_not_found' },
  { type: InvalidPublicPrefixError, status: 422, code: 'invalid_public_prefix' },
  { type: ConnectionNotFoundError, status: 404, code: 'connection_not_found' },
  { type: ConnectionNameTakenError, status: 409, code: 'connection_name_taken' },
  { type: ConnectionInUseError, status: 409, code: 'connection_in_use' },
  { type: UnknownProviderError, status: 422, code: 'unknown_provider' },
  { type: InvalidTargetConfigError, status: 422, code: 'invalid_target_config' },
  // 인프라가 우리 자격 증명을 거부한 것이라 401이 아니라 422로 알린다 (대시보드 로그인과 헷갈리지 않게)
  { type: TargetAuthError, status: 422, code: 'target_auth_failed' },
  { type: TargetNotFoundError, status: 404, code: 'target_resource_not_found' },
  { type: TargetUnavailableError, status: 502, code: 'target_unavailable' },
  {
    type: PublishValidationError,
    status: 422,
    code: 'publish_validation',
    details: (e: PublishValidationError) => ({ issues: e.issues }),
  },
  {
    type: ChangeSetConflictError,
    status: 422,
    code: 'change_set_conflict',
    details: (e: ChangeSetConflictError) => ({ keys: e.keys }),
  },
  {
    type: BrokenReferenceError,
    status: 409,
    code: 'broken_reference',
    details: (e: BrokenReferenceError) => ({ issues: e.issues }),
  },
  { type: NotOrgMemberError, status: 403, code: 'not_org_member' },
  { type: UserDisabledError, status: 403, code: 'user_disabled' },
  { type: GitHubAuthError, status: 401, code: 'github_auth_failed' },
  { type: GitHubUnavailableError, status: 503, code: 'github_unavailable' },
  { type: InvalidRefreshTokenError, status: 401, code: 'invalid_refresh_token' },
  { type: RefreshTokenReusedError, status: 401, code: 'refresh_token_reused' },
  { type: InvalidDeviceCodeError, status: 400, code: 'invalid_grant' },
  { type: DeviceCodeNotFoundError, status: 404, code: 'device_code_not_found' },
  { type: DeviceCodeExpiredError, status: 410, code: 'device_code_expired' },
  { type: DeviceApprovalForbiddenError, status: 403, code: 'approval_forbidden' },
  { type: AdminRequiredError, status: 403, code: 'admin_required' },
  { type: UserNotFoundError, status: 404, code: 'user_not_found' },
  { type: CannotDisableSelfError, status: 422, code: 'cannot_disable_self' },
  { type: LastAdminError, status: 422, code: 'last_admin' },
  { type: UserAlreadyExistsError, status: 409, code: 'user_exists' },
  { type: InvalidGitHubLoginError, status: 422, code: 'invalid_github_login' },
  { type: AssignmentNotFoundError, status: 404, code: 'assignment_not_found' },
];

/** Nest 기본 예외의 상태 코드를 우리 code로 바꾼다 */
const HTTP_CODES: Record<number, string> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  429: 'too_many_requests',
};

/**
 * 오류를 API 응답으로 바꾼다. 모르는 오류는 내부 내용(DB 주소, 스택 등)이
 * 새지 않도록 일반 메시지만 돌려준다.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiProblem) {
    const body: ApiErrorBody = { code: error.code, message: error.message };
    if (error.details) body.details = error.details;
    return { status: error.status, body };
  }

  for (const rule of RULES) {
    if (error instanceof rule.type) {
      const body: ApiErrorBody = { code: rule.code, message: error.message };
      if (rule.details) body.details = rule.details(error as never);
      return { status: rule.status, body };
    }
  }

  if (error instanceof HttpException) {
    const status = error.getStatus();
    const code = HTTP_CODES[status];
    if (code) return { status, body: { code, message: error.message } };
  }

  return { status: 500, body: { code: 'internal_error', message: '서버 오류가 발생했습니다' } };
}
