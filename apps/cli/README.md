# senv (@billilge/senv)

Stream Env Control CLI. 환경변수를 서버에서 받아 파일 없이 실행하거나(`senv run`) `.env`로 쓴다(`senv pull`).

## 설치

GitHub Packages 비공개 패키지라 `read:packages` 권한이 있는 GitHub 토큰이 필요하다.

```sh
# ~/.npmrc
@billilge:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<read:packages 권한 토큰>
```

```sh
npm install -g @billilge/senv   # Node.js 22 이상
senv login
```

## 자주 쓰는 명령

| 명령 | 하는 일 |
| --- | --- |
| `senv init` | 저장소에 `senv.json`을 만들고 출력 파일을 `.gitignore`에 넣는다 |
| `senv run -- <명령>` | 값을 파일 없이 환경변수로 넣어 실행한다 (권장) |
| `senv pull` | 값을 `.env` 파일로 쓴다 |
| `senv status` / `senv diff` | 받은 파일이 최신인지 / 서버 값과 무엇이 다른지 (키 이름만) |
| `senv set KEY=VALUE` / `senv push` | 값을 바꿔 새 버전으로 게시한다 (확인을 받는다) |
| `senv export --format json` | 값을 원하는 형식으로 표준 출력에 쓴다 |
| `senv doctor` | 설정·로그인·.gitignore·필수 키·타입·클라이언트 노출을 점검한다 |

서버 주소는 기본으로 `https://senv.stream.billilge.site`이고 `SENV_API_URL`로 바꾼다.

## Spring Boot

터미널에서는 파일 없이 실행한다. Spring은 환경변수를 바로 읽는다 (`SPRING_DATASOURCE_URL` → `spring.datasource.url`).

```sh
senv run -- ./gradlew bootRun
senv run -- ./gradlew test
```

IntelliJ 실행 버튼처럼 senv를 거치지 않고 띄울 때는 `properties` 형식으로 받는다.

```sh
senv init --format properties   # senv.json에 "format": "properties", 출력 파일 .env.local.properties
senv pull
```

```yaml
# src/main/resources/application-local.yml
spring:
  config:
    import: optional:file:.env.local.properties
  datasource:
    url: ${DB_URL}
```

- 파일의 키에는 relaxed binding이 적용되지 않으므로 `${DB_URL}`처럼 참조한다.
- Spring은 값 안의 `${...}`를 다른 속성으로 바꾼다. 그런 값이 있으면 `pull`이 알려준다.

## 배포 (관리자)

`apps/cli/package.json`의 `version`과 `src/program.ts`의 `VERSION`을 올리고 `cli-v<version>` 태그를 푸시하면 GitHub Actions가 GitHub Packages에 올린다.
