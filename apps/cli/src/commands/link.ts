import { realpath } from 'node:fs/promises';
import { type ApiSchemas, unwrap } from '@senv/api-client';
import { localLinkSyncState } from '@senv/core';
import { ensureDevice } from '../agent/agent.js';
import { findProjectConfig } from '../config/project-config.js';
import type { CliContext } from '../context.js';

/** senv link: 이 PC의 로컬 연결 보기·승인·거절·추가 (M1.1, PRD 결정 60~61) */

type LocalLink = ApiSchemas['LocalLink'];

const STATUS_LABEL: Record<LocalLink['status'], string> = {
  pending: '승인 대기',
  active: '활성',
  paused: '일시정지',
};

export async function linkList(context: CliContext): Promise<void> {
  const deviceId = await ensureDevice(context);
  const { links } = await unwrap(
    context.api.GET('/api/v1/agent/devices/{id}/links', { params: { path: { id: deviceId } } }),
  );
  if (links.length === 0) {
    context.out.info(
      '이 PC에 연결이 없습니다. 대시보드의 "내 로컬 연결"이나 senv link add로 추가하세요.',
    );
    return;
  }
  context.out.result(
    links
      .map((link) =>
        [link.id, STATUS_LABEL[link.status], link.project, link.path, describe(link)].join('  '),
      )
      .join('\n'),
  );
}

export async function linkApprove(context: CliContext, id: string): Promise<void> {
  const link = await unwrap(
    context.api.POST('/api/v1/agent/links/{id}/approve', { params: { path: { id } } }),
  );
  context.out.info(
    `${link.project} → ${link.path} 연결을 승인했습니다. senv agent가 다음 확인 때 씁니다.`,
  );
}

export async function linkReject(context: CliContext, id: string): Promise<void> {
  await unwrap(context.api.POST('/api/v1/agent/links/{id}/reject', { params: { path: { id } } }));
  context.out.info('연결을 거절해서 지웠습니다.');
}

/** 지금 폴더(가장 가까운 senv.json)를 이 PC의 연결로 바로 추가한다. PC에서 했으니 승인이 필요 없다 */
export async function linkAdd(context: CliContext): Promise<void> {
  const { root, config } = await findProjectConfig(context.cwd);
  const deviceId = await ensureDevice(context);
  const link = await unwrap(
    context.api.POST('/api/v1/agent/devices/{id}/links', {
      params: { path: { id: deviceId } },
      body: { project: config.project, path: await realpath(root) },
    }),
  );
  context.out.info(
    `${link.project} → ${link.path} 연결을 추가했습니다. senv agent가 local 값을 ${config.output}에 씁니다.`,
  );
}

function describe(link: LocalLink): string {
  if (link.lastState && link.lastState.state !== 'ok') {
    return `${link.lastState.state}: ${link.lastState.message ?? ''}`.trim();
  }
  const sync = localLinkSyncState(link.current, link.lastWritten);
  if (sync === 'never') return '아직 쓰지 않음';
  const written = link.lastWritten as NonNullable<LocalLink['lastWritten']>;
  return sync === 'synced'
    ? `v${written.version} 반영됨`
    : `v${written.version} 반영됨, v${link.current.version} 대기`;
}
