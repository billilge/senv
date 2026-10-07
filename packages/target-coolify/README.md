# @senv/target-coolify

Coolify 배포 대상 제공자 (PRD 8.5). `packages/core`의 `TargetProvider`를 구현한다.

## 연결

| 필드 | 설명 |
| --- | --- |
| `url` | Coolify 주소. 끝의 `/`와 `/api/v1`은 정리해서 저장한다. 같은 서버의 Coolify는 내부 주소를 쓴다 |
| `token` (비밀) | Coolify `Keys & Tokens > API tokens`에서 발급한 토큰 |

## 지원 기능

`readValues`, `deleteKeys`, `restart`·`redeploy`, `buildTimeFlag` 모두 지원한다. 리소스는 Application이다 (Service는 M4).

| 인터페이스 | Coolify API |
| --- | --- |
| `testConnection`, `listResources` | `GET /api/v1/applications` |
| `readVariables` | `GET /api/v1/applications/{uuid}/envs` (preview가 아닌 변수만) |
| `applyPlan` 추가·변경 | `PATCH /api/v1/applications/{uuid}/envs/bulk` 한 번 |
| `applyPlan` 삭제 | 변수 uuid를 찾아 `DELETE /api/v1/applications/{uuid}/envs/{env_uuid}` |
| `runAction('restart')` | `POST /api/v1/applications/{uuid}/restart` |
| `runAction('redeploy')` | `GET /api/v1/deploy?uuid={uuid}` |

## 속성 대응

| 공통 속성 | Coolify 필드 |
| --- | --- |
| `buildTime: true` | `is_buildtime: true`, `is_runtime: false` |
| `buildTime: false` | `is_buildtime: false`, `is_runtime: true` |
| `multiline` | `is_multiline` |
| (항상) 값의 `$`를 치환하지 않음 | `is_literal: true` |
| 매핑 옵션 `preview` | 같은 값을 `is_preview: true` 변수로도 넣는다 |

## 제약

- 필드 이름은 Coolify v4 최신 API 기준이다. 운영 중인 Coolify 버전에서 필드 이름(`is_buildtime` 등)과 메서드가 같은지 먼저 확인한다 (PRD 14.1).
- 테스트는 실제 Coolify에 붙지 않는다. `src/testing/fake-coolify.ts`가 API 응답 모양을 흉내 내고, `@senv/target-testkit`의 계약 테스트를 통과한다.
