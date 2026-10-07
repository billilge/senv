#!/usr/bin/env bash
# 배포 이미지 검사: docker-compose.yml을 MySQL과 함께 띄워 api·worker가 실제로 동작하는지 본다.
# 몇 분 걸려서 pnpm verify에는 넣지 않는다. 사용법: pnpm smoke:docker
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${SMOKE_PORT:-38080}"
BASE="http://127.0.0.1:${PORT}"
COMPOSE=(docker compose -p senv-smoke -f docker-compose.yml -f scripts/docker-compose.smoke.yml)

# 검사용 값. 실제 비밀이 아니며 이 실행에서만 쓴다
export APP_URL="http://localhost:${PORT}"
export DATABASE_URL="mysql://stream_env:smoke-pw@mysql:3306/stream_env"
export S3_ENDPOINT="http://storage.invalid" S3_ACCESS_KEY_ID="smoke" S3_SECRET_ACCESS_KEY="smoke" S3_BUCKET="stream-env"
export SENV_KEK="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
export SENV_KEK_ID="kek-smoke"
export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export GITHUB_CLIENT_ID="smoke" GITHUB_CLIENT_SECRET="smoke" GITHUB_ORG="billilge"

fail() {
  echo "✗ $1" >&2
  "${COMPOSE[@]}" logs --no-color api worker | tail -50 >&2 || true
  exit 1
}
cleanup() { "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "→ 이미지 빌드와 기동 (api가 healthy가 될 때까지 기다린다)"
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 300 || fail "기동하지 못했습니다"

echo "→ 마이그레이션"
applied=$("${COMPOSE[@]}" exec -T mysql mysql -ustream_env -psmoke-pw -N stream_env \
  -e "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>/dev/null)
expected=$(find apps/server/prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
[ "$applied" = "$expected" ] || fail "마이그레이션 ${applied}/${expected}개만 적용됨"

echo "→ 헬스체크"
[ "$(curl -fsS "$BASE/healthz")" = '{"status":"ok"}' ] || fail "/healthz"

echo "→ 대시보드 (SPA 경로와 해시된 파일)"
html=$(curl -fsS "$BASE/projects/web")
grep -q '<div id="root">' <<<"$html" || fail "대시보드 index.html이 아닙니다"
asset=$(grep -o '/assets/[^"]*\.js' <<<"$html" | head -1)
[ -n "$asset" ] || fail "index.html에 JS 파일이 없습니다"
curl -fsSI "$BASE$asset" | grep -qi 'cache-control: public, max-age=31536000, immutable' || fail "$asset 캐시 헤더"

echo "→ API"
code=$(curl -s -o /tmp/senv-smoke-me.json -w '%{http_code}' "$BASE/api/v1/me")
[ "$code" = 401 ] && grep -q '"code":"unauthorized"' /tmp/senv-smoke-me.json || fail "/api/v1/me → $code"

echo "→ worker (재시작 없이 돌고 있는지)"
sleep 5
worker=$("${COMPOSE[@]}" ps -q worker)
[ "$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$worker")" = "true 0" ] || fail "worker가 멈추거나 다시 시작됨"

echo "✓ 배포 이미지 검사 통과"
