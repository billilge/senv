# syntax=docker/dockerfile:1
# Stream Env Control 서버 이미지. api와 worker가 같은 이미지를 쓰고 실행 명령만 다르다 (PRD 4.5).
# 대시보드 빌드도 함께 담아 서버가 같은 도메인에서 제공한다.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base
# Prisma 마이그레이션 엔진이 OpenSSL로 플랫폼을 판단한다
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# 서버와 대시보드에 필요한 패키지만 남긴 작업 공간 (turbo prune)
FROM base AS prune
RUN npm install -g turbo@2.11.7
COPY . .
RUN turbo prune @senv/server @senv/dashboard --docker

# 의존성(자주 안 바뀜)을 먼저 설치하고 소스를 복사해 빌드한다
FROM base AS build
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN pnpm turbo run build --filter=@senv/server --filter=@senv/dashboard

# 운영 의존성만 (서버와 서버가 쓰는 워크스페이스 패키지). 대시보드는 빌드 결과 파일만 쓴다
FROM base AS prod-deps
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --prod --filter @senv/server...

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app ./
# 서버가 실행 중에 불러오는 워크스페이스 패키지의 빌드 결과 (src/app/docker-image.test.ts가 빠짐을 검사한다)
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/target-coolify/dist ./packages/target-coolify/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
COPY --from=build /app/apps/server/prisma.config.ts ./apps/server/prisma.config.ts
# main.js가 ../../dashboard/dist를 찾으므로 모노레포 구조 그대로 둔다
COPY --from=build /app/apps/dashboard/dist ./apps/dashboard/dist
WORKDIR /app/apps/server
USER node
EXPOSE 3000
# api: 마이그레이션을 적용한 뒤 시작한다. worker는 docker-compose.yml에서 명령을 바꾼다
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]
