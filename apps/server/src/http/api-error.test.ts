import { NotFoundException } from '@nestjs/common';
import { ChangeSetConflictError } from '@senv/core';
import { describe, expect, it } from 'vitest';
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
} from '../publishing/publish-service.js';
import {
  AdminRequiredError,
  CannotDisableSelfError,
  LastAdminError,
  UserNotFoundError,
} from '../users/users-service.js';
import { RequestValidationError, toApiError } from './api-error.js';

describe('toApiError', () => {
  it.each([
    [new ProjectNotFoundError('web'), 404, 'project_not_found'],
    [new InvalidEnvironmentError('staging'), 400, 'invalid_environment'],
    [new InvalidProjectNameError('Web'), 422, 'invalid_project_name'],
    [new ReservedProjectNameError('shared'), 422, 'reserved_project_name'],
    [new ProjectNameTakenError('web'), 409, 'project_name_taken'],
    [new NoChangesError(), 422, 'no_changes'],
    [new NotOrgMemberError('bob', 'none'), 403, 'not_org_member'],
    [new UserDisabledError('bob'), 403, 'user_disabled'],
    [new GitHubAuthError(), 401, 'github_auth_failed'],
    [new GitHubUnavailableError(), 503, 'github_unavailable'],
    [new InvalidRefreshTokenError(), 401, 'invalid_refresh_token'],
    [new RefreshTokenReusedError(), 401, 'refresh_token_reused'],
    [new InvalidDeviceCodeError(), 400, 'invalid_grant'],
    [new DeviceCodeNotFoundError(), 404, 'device_code_not_found'],
    [new DeviceCodeExpiredError(), 410, 'device_code_expired'],
    [new DeviceApprovalForbiddenError(), 403, 'approval_forbidden'],
    [new AdminRequiredError(), 403, 'admin_required'],
    [new UserNotFoundError('u1'), 404, 'user_not_found'],
    [new CannotDisableSelfError(), 422, 'cannot_disable_self'],
    [new LastAdminError(), 422, 'last_admin'],
  ])('%s → %i %s, 메시지는 오류의 메시지 그대로', (error, status, code) => {
    expect(toApiError(error)).toEqual({ status, body: { code, message: error.message } });
  });

  it('기준 버전 충돌은 409이고 현재 버전을 details로 알려준다', () => {
    expect(toApiError(new VersionConflictError(2, 5))).toMatchObject({
      status: 409,
      body: { code: 'version_conflict', details: { baseVersion: 2, currentVersion: 5 } },
    });
  });

  it('게시 검증 실패는 422이고 문제 목록을 details로 알려준다', () => {
    const issues = [{ code: 'invalid_key_name', key: 'bad' } as const];
    expect(toApiError(new PublishValidationError(issues))).toMatchObject({
      status: 422,
      body: { code: 'publish_validation', details: { issues } },
    });
  });

  it('set·remove 충돌은 422이고 키 목록을 알려준다', () => {
    expect(toApiError(new ChangeSetConflictError(['A']))).toMatchObject({
      status: 422,
      body: { code: 'change_set_conflict', details: { keys: ['A'] } },
    });
  });

  it('깨진 공유 참조는 409이고 문제 목록을 알려준다', () => {
    const issues = [{ code: 'missing_reference', key: 'A', reference: '$' } as const];
    expect(toApiError(new BrokenReferenceError(issues))).toMatchObject({
      status: 409,
      body: { code: 'broken_reference', details: { issues } },
    });
  });

  it('요청 형식 오류는 400 invalid_request이고 문제 위치를 알려준다', () => {
    const issues = [{ path: 'changes.set', message: '문자열이어야 합니다' }];
    expect(toApiError(new RequestValidationError(issues))).toEqual({
      status: 400,
      body: {
        code: 'invalid_request',
        message: '요청 형식이 올바르지 않습니다',
        details: { issues },
      },
    });
  });

  it('없는 경로(NotFoundException)는 404 not_found다', () => {
    expect(toApiError(new NotFoundException())).toMatchObject({
      status: 404,
      body: { code: 'not_found' },
    });
  });

  it('알 수 없는 오류는 500 internal_error이고 내부 내용을 메시지에 담지 않는다', () => {
    const result = toApiError(new Error('mysql://stream_env:secret@db failed'));
    expect(result).toEqual({
      status: 500,
      body: { code: 'internal_error', message: '서버 오류가 발생했습니다' },
    });
  });
});
