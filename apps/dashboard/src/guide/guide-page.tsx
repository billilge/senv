// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${shared.KEY}, ${DB_URL} 같은 참조 문법을 글자 그대로 보여준다
import { PageHeader, Link as PrimerLink } from '@primer/react';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import table from '../ui/data-table.module.css';
import { C, Command } from './command';
import styles from './guide.module.css';

/** senv 사용 가이드 (결정 72). 설치부터 문제 해결까지, 실제 명령과 화면 기준으로 설명한다 */

interface Section {
  id: string;
  title: string;
  body: ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'intro',
    title: 'senv란',
    body: (
      <>
        <p>
          senv(Stream Env Control)는 팀의 환경변수와 시크릿을 한곳에서 관리하는 도구입니다. 값은
          서버에 암호화해 보관하고, 프로젝트마다 <C>local</C>, <C>development</C>, <C>production</C>{' '}
          세 환경으로 나눕니다.
        </p>
        <ul>
          <li>
            값을 바꾸면 <strong>게시</strong>해서 새 버전을 만듭니다. 버전 기록에서 비교하고 되돌릴
            수 있습니다.
          </li>
          <li>
            개발자는 <C>senv</C> CLI로 값을 받아 씁니다. 파일을 남기지 않는 <C>senv run</C>이
            기본입니다.
          </li>
          <li>
            관리자가 배포 대상을 연결해 두면 게시할 때 Coolify 앱의 환경변수도 자동으로 바뀝니다.
          </li>
          <li>값을 Slack, 노션, 메신저에 붙여넣지 마세요. 필요한 사람은 senv로 받으면 됩니다.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'install',
    title: '설치',
    body: (
      <>
        <p>
          Node.js 22 이상이 필요합니다. CLI는 GitHub Packages의 비공개 패키지라서, 먼저 GitHub
          토큰으로 레지스트리에 로그인해야 합니다.
        </p>
        <ol>
          <li>
            GitHub → Settings → Developer settings → Personal access tokens (classic)에서{' '}
            <C>read:packages</C> 권한만 있는 토큰을 만듭니다.
          </li>
          <li>
            홈 폴더의 <C>~/.npmrc</C>에 아래 두 줄을 넣습니다. 이 파일은 저장소에 커밋하지 않습니다.
          </li>
        </ol>
        <Command label=".npmrc 설정">
          {
            '@billilge:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=<GitHub 토큰>'
          }
        </Command>
        <p>CLI를 설치하고 버전을 확인합니다.</p>
        <Command label="설치 명령">npm i -g @billilge/senv</Command>
        <Command label="버전 확인 명령">senv --version</Command>
      </>
    ),
  },
  {
    id: 'login',
    title: '로그인',
    body: (
      <>
        <Command label="로그인 명령">senv login</Command>
        <ul>
          <li>
            브라우저가 열리면 GitHub로 로그인하고 CLI에 표시된 코드를 승인합니다. 브라우저를 열 수
            없는 환경이면 <C>senv login --no-browser</C>로 주소만 받습니다.
          </li>
          <li>
            billilge 조직 멤버만 로그인할 수 있습니다. 처음 로그인하면 관리자 승인을 기다리는 상태가
            됩니다.
          </li>
          <li>
            토큰은 OS 키체인에 저장됩니다. <C>senv whoami</C>로 확인하고, PC를 넘기거나 잃어버리면{' '}
            <C>senv logout</C>을 하거나 관리자에게 알리세요.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'init',
    title: '프로젝트 연결',
    body: (
      <>
        <p>
          저장소 루트(모노레포라면 패키지 폴더)에서 실행합니다. 프로젝트를 고르면 <C>senv.json</C>을
          만들고, 값 파일(<C>.env.local</C>)을 <C>.gitignore</C>에 넣습니다.
        </p>
        <Command label="init 명령">senv init</Command>
        <Command label="senv.json 예시">
          {
            '{\n  "project": "web",\n  "defaultEnv": "local",\n  "output": ".env.local",\n  "format": "dotenv"\n}'
          }
        </Command>
        <ul>
          <li>
            <C>senv.json</C>에는 값이 없으므로 <strong>커밋합니다</strong>. 팀원은 저장소를 받은 뒤
            로그인만 하면 됩니다.
          </li>
          <li>
            <C>--project web</C>으로 프로젝트를 바로 지정하고, <C>--env development</C>로 기본
            환경을 바꿀 수 있습니다.
          </li>
          <li>
            Spring Boot는 <C>--format properties</C>를 씁니다 (
            <PrimerLink href="#frameworks">프레임워크별 사용법</PrimerLink>).
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'use',
    title: '값 받아 쓰기',
    body: (
      <>
        <h4>파일 없이 실행 (권장)</h4>
        <p>값을 환경변수로 넣어 명령을 실행합니다. 디스크에 값이 남지 않습니다.</p>
        <Command label="run 명령">senv run -- pnpm dev</Command>
        <p>
          다른 환경은 <C>--env</C>로 고릅니다: <C>senv run --env development -- pnpm test</C>
        </p>
        <h4>파일로 받기</h4>
        <p>
          <C>.env</C> 파일을 직접 읽는 도구(IDE 실행 버튼 등)에만 씁니다. 파일은 권한 600으로 쓰고,
          첫 줄에 버전이 남습니다. git이 무시하지 않는 파일에는 쓰지 않습니다.
        </p>
        <Command label="pull 명령">senv pull</Command>
        <ul>
          <li>
            <C>senv status</C>: 받은 파일이 최신인지 확인합니다.
          </li>
          <li>
            <C>senv diff</C>: 받은 파일과 서버 값의 차이를 <strong>키 이름만</strong> 보여줍니다.
          </li>
          <li>
            <C>senv list</C>: 키 목록 (값은 가립니다). <C>senv get KEY</C>: 값 하나를 출력합니다.
            화면 공유 중에는 쓰지 마세요.
          </li>
          <li>
            <C>senv export --format json</C>: <C>dotenv</C>, <C>json</C>, <C>shell</C>, <C>yaml</C>,{' '}
            <C>properties</C> 형식으로 표준 출력에 씁니다.
          </li>
        </ul>
        <p className={styles.note}>
          받은 파일은 직접 고치지 마세요. 다음에 받을 때 바뀌고, 로컬 자동 받기는 고친 파일을
          덮어쓰지 않고 멈춥니다.
        </p>
      </>
    ),
  },
  {
    id: 'edit',
    title: '값 바꾸기',
    body: (
      <>
        <h4>대시보드에서</h4>
        <ol>
          <li>
            <Link to="/">프로젝트</Link>에서 프로젝트를 열고, 값 탭에서 환경의 <strong>편집</strong>
            을 누릅니다.
          </li>
          <li>
            값을 고치거나 키를 추가·삭제합니다. 기존 <C>.env</C> 내용을 붙여넣으면 추가·변경·삭제
            후보로 나눠 채웁니다.
          </li>
          <li>
            <strong>변경 확인</strong>에서 바뀌는 키를 보고, 게시 메시지를 적어{' '}
            <strong>게시</strong>합니다.
          </li>
        </ol>
        <p>
          <strong>환경 간 복사</strong>로 다른 환경의 값을 가져올 수 있고,{' '}
          <strong>버전 기록</strong> 탭에서 두 버전을 비교하거나 지난 버전으로 되돌립니다. 다른
          사람이 먼저 게시했으면 충돌을 알려주니 최신 값을 다시 불러와 편집하세요.
        </p>
        <h4>CLI에서</h4>
        <Command label="set 명령">
          senv set API_URL=https://api.example.com -m "API 주소 변경"
        </Command>
        <ul>
          <li>
            바뀌는 키를 보여주고 확인을 받습니다. <C>-y</C>로 확인을 건너뜁니다.
          </li>
          <li>production은 프로젝트 이름을 다시 입력해야 합니다.</li>
          <li>
            기존 <C>.env</C> 파일을 옮길 때는 <C>senv push</C>를 씁니다. 서버와 다른 키만 올리고,{' '}
            <C>--prune</C>을 붙이면 파일에 없는 키를 지웁니다.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'schema',
    title: '키 스키마와 노출 검사',
    body: (
      <>
        <ul>
          <li>
            키 이름은 대문자, 숫자, 밑줄만 쓰고 숫자로 시작하지 않습니다 (예: <C>PAYMENT_API_URL</C>
            ).
          </li>
          <li>
            프로젝트의 <strong>키 스키마</strong> 탭에서 키마다 타입, 필수 여부, secret·public, 빌드
            시점 여부, 설명을 정합니다. 필수 키가 빠지거나 타입이 틀리면 게시할 수 없습니다.
          </li>
          <li>secret 값은 대시보드에서 가려서 보여주고, 보기를 누르면 30초 동안 보입니다.</li>
          <li>
            <C>VITE_</C>, <C>EXPO_PUBLIC_</C>처럼 앱 번들에 들어가는 공개 접두사가 붙은 키에 secret
            값이 있으면 <C>pull</C>과 <C>run</C>이 멈춥니다. 키 이름을 바꾸거나 스키마에서
            public으로 정하세요.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'shared',
    title: '공유 그룹',
    body: (
      <>
        <p>
          여러 프로젝트가 같이 쓰는 값은 <strong>공유 그룹</strong>에 두고 참조합니다. 값을 받을 때
          참조가 실제 값으로 풀립니다.
        </p>
        <Command label="공유 참조 예시">{'VITE_API_URL=https://${shared.API_HOST}/v1'}</Command>
        <p>
          공유 값을 게시하면 그 값을 참조하는 프로젝트가 다음에 받을 때(그리고 배포 대상 자동 반영
          때) 새 값이 들어갑니다.
        </p>
      </>
    ),
  },
  {
    id: 'frameworks',
    title: '프레임워크별 사용법',
    body: (
      <>
        <h4>Vite·React</h4>
        <Command label="Vite 실행 명령">senv run -- pnpm dev</Command>
        <p>
          브라우저에 들어가는 값은 <C>VITE_</C>로 시작합니다. Vite는 <C>.env</C> 파일의 <C>$</C>를
          치환하므로, <C>$</C>가 든 값은 <C>senv run</C>으로 넣으세요. <C>pull</C>이 그런 키를
          알려줍니다.
        </p>
        <h4>Expo</h4>
        <Command label="Expo 실행 명령">senv run -- npx expo start</Command>
        <p>
          앱에 들어가는 값은 <C>EXPO_PUBLIC_</C>으로 시작합니다.
        </p>
        <h4>Spring Boot</h4>
        <p>터미널에서는 파일 없이 실행합니다. Spring은 환경변수를 바로 읽습니다.</p>
        <Command label="Spring 실행 명령">senv run -- ./gradlew bootRun</Command>
        <p>IntelliJ 실행 버튼처럼 senv를 거치지 않을 때는 properties 형식으로 받습니다.</p>
        <Command label="properties 초기화 명령">senv init --format properties</Command>
        <Command label="application-local.yml 예시">
          {
            'spring:\n  config:\n    import: optional:file:.env.local.properties\n  datasource:\n    url: ${DB_URL}'
          }
        </Command>
        <ul>
          <li>
            파일의 키에는 relaxed binding이 적용되지 않으므로 <C>{'${DB_URL}'}</C>처럼 참조합니다.
          </li>
          <li>
            Spring은 값 안의 <C>{'${...}'}</C>를 다른 속성으로 바꿉니다. 그런 값이 있으면{' '}
            <C>pull</C>이 알려줍니다.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'agent',
    title: '로컬 자동 받기',
    body: (
      <>
        <p>
          local 값이 게시되면 내 PC 폴더의 값 파일을 자동으로 바꿉니다. 매번 <C>senv pull</C>을 하지
          않아도 됩니다.
        </p>
        <ol>
          <li>
            값을 받을 PC에서 자동 시작을 켭니다 (macOS, Linux). 로그인할 때마다 에이전트가 뜨고,
            30초마다 확인합니다.
          </li>
        </ol>
        <Command label="자동 시작 명령">senv agent install</Command>
        <ol start={2}>
          <li>
            대시보드 오른쪽 위 사용자 메뉴 → <Link to="/me/local">내 로컬 연결</Link>에서 PC,
            프로젝트, 폴더(<C>senv.json</C>이 있는 폴더의 절대 경로)를 골라 연결을 추가합니다.
          </li>
          <li>대시보드에서 추가한 연결은 그 PC에서 한 번 승인해야 씁니다.</li>
        </ol>
        <Command label="연결 승인 명령">senv link approve &lt;연결 ID&gt;</Command>
        <ul>
          <li>
            <C>senv link list</C>: 이 PC의 연결과 ID, 상태. <C>senv link add</C>: 지금 폴더를 바로
            연결합니다 (승인 필요 없음).
          </li>
          <li>
            직접 고친 파일은 덮어쓰지 않고 "로컬에서 수정됨"으로 표시합니다. 내 로컬 연결 화면에서{' '}
            <strong>덮어쓰기</strong>를 누르면 씁니다.
          </li>
          <li>
            폴더에 <C>senv.json</C>이 없거나, 프로젝트가 다르거나, 출력 파일이 git에서 무시되지
            않으면 쓰지 않고 이유를 보여줍니다.
          </li>
          <li>
            <C>senv agent status</C>로 상태를 보고, <C>senv agent uninstall</C>로 끕니다 (이미 쓴
            파일은 남습니다). Windows는 터미널에서 <C>senv agent</C>를 직접 실행하세요.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'deploy',
    title: '배포 서버 자동 반영',
    body: (
      <>
        <p>
          관리자가 <strong>배포 대상</strong>에 Coolify를 연결하고 프로젝트의 <strong>배포</strong>{' '}
          탭에서 환경과 앱을 매핑하면, 게시할 때 그 앱의 환경변수가 자동으로 바뀌고 필요하면
          재시작이나 재배포까지 합니다.
        </p>
        <ul>
          <li>
            배포 탭에서 마지막 반영 결과를 보고, 바뀔 키를 미리 확인한 뒤 지금 동기화할 수 있습니다.
          </li>
          <li>
            Coolify 화면에서 환경변수를 직접 고치지 마세요. senv가 "직접 바뀐 키"(드리프트)로
            표시하고, 다음 게시 때 senv 값으로 돌아갑니다.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'claude',
    title: 'Claude Code에서 쓰기',
    body: (
      <>
        <p>
          senv 플러그인을 설치하면 Claude Code가 <C>senv run</C>·<C>list</C>·<C>diff</C>를 쓰고, 값
          파일(<C>.env.local</C> 등)을 읽지 않습니다.
        </p>
        <Command label="마켓플레이스 추가 명령">
          /plugin marketplace add billilge/stream-marketplace
        </Command>
        <Command label="플러그인 설치 명령">/plugin install senv@stream-marketplace</Command>
        <p className={styles.note}>
          저장소의 <C>.claude/settings.json</C>에 넣을 설정은 stream-marketplace 저장소의 README를
          보세요.
        </p>
      </>
    ),
  },
  {
    id: 'trouble',
    title: '문제 해결',
    body: (
      <>
        <p>먼저 점검 명령으로 설정, 로그인, .gitignore, 필수 키, 노출 검사를 한 번에 확인하세요.</p>
        <Command label="점검 명령">senv doctor</Command>
        <div className={table.container}>
          <table className={table.table}>
            <thead>
              <tr>
                <th scope="col">증상</th>
                <th scope="col">할 일</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>로그인이 필요하다, 로그인이 만료되었다</td>
                <td>
                  <C>senv login</C>
                </td>
              </tr>
              <tr>
                <td>관리자의 승인을 기다리는 중</td>
                <td>대시보드 관리자에게 승인을 요청합니다</td>
              </tr>
              <tr>
                <td>senv.json을 찾을 수 없다</td>
                <td>
                  저장소에서 <C>senv init</C>
                </td>
              </tr>
              <tr>
                <td>git에서 무시되지 않아 쓰지 않았다</td>
                <td>
                  값 파일을 <C>.gitignore</C>에 넣습니다 (<C>senv init</C>이 넣어 줍니다)
                </td>
              </tr>
              <tr>
                <td>secret 값이 클라이언트 번들에 들어가는 이름</td>
                <td>키 이름을 바꾸거나 키 스키마에서 public으로 정합니다</td>
              </tr>
              <tr>
                <td>그 사이 다른 게시가 있었다 (충돌)</td>
                <td>최신 값을 다시 불러와 편집합니다</td>
              </tr>
              <tr>
                <td>서버에 연결할 수 없다</td>
                <td>네트워크와 VPN을 확인합니다</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: 'rules',
    title: '지켜 주세요',
    body: (
      <ul>
        <li>
          값 파일(<C>.env.local</C> 등)은 커밋하지 않습니다.
        </li>
        <li>값을 메신저, 문서, 이슈에 붙여넣지 않습니다. 필요한 사람은 senv로 받습니다.</li>
        <li>production 값은 게시 전에 변경 확인을 꼭 봅니다.</li>
        <li>PC를 잃어버리거나 넘기면 바로 관리자에게 알립니다.</li>
      </ul>
    ),
  },
];

export function GuidePage() {
  return (
    <>
      <PageHeader>
        <PageHeader.TitleArea>
          <PageHeader.Title as="h2">senv 사용 가이드</PageHeader.Title>
        </PageHeader.TitleArea>
        <PageHeader.Description>
          설치부터 값 받아 쓰기, 바꾸기, 자동 반영, 문제 해결까지
        </PageHeader.Description>
      </PageHeader>
      <div className={styles.layout}>
        <nav aria-label="목차" className={styles.toc}>
          <ol>
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        <div className={styles.body}>
          {SECTIONS.map((section) => (
            <section key={section.id} id={section.id} className={styles.section}>
              <h3>{section.title}</h3>
              {section.body}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
