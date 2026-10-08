import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ApiSchemas, SenvApiError, unwrap } from '@senv/api-client';
import { decideLocalWrite, type LocalLinkState, type VersionPair } from '@senv/core';
import { NotLoggedInError } from '../auth/session.js';
import { ExposedSecretError, fetchVariables } from '../commands/target.js';
import {
  CONFIG_FILE,
  findProjectConfig,
  InvalidProjectConfigError,
  type LoadedProjectConfig,
} from '../config/project-config.js';
import type { CliContext } from '../context.js';
import {
  checkOutput,
  hashText,
  readValueFile,
  renderValueFile,
  writeValueFile,
} from '../files/value-file.js';

/**
 * 로컬 자동 받기 에이전트의 한 주기 (M1.1, PRD 결정 60~63).
 * 서버가 알려준 경로를 그대로 믿지 않는다: 폴더에 senv.json이 있고 프로젝트가 같으며,
 * 출력 파일이 git에서 무시되고 심볼릭 링크가 아닐 때만 값을 받아 쓴다 (결정 61).
 */

type LocalLink = ApiSchemas['LocalLink'];

export interface AgentState {
  /** 서버에 등록한 이 PC의 기기 ID */
  deviceId: string | null;
  /** 연결마다 이 PC가 마지막으로 쓴 버전과 내용 해시. 해시는 서버로 보내지 않는다 */
  written: Record<string, VersionPair & { hash: string }>;
}

/** 한 번 실행하는 동안 기억할 것 (같은 안내를 주기마다 되풀이하지 않는다) */
export interface AgentSession {
  notified: Set<string>;
}

interface Outcome {
  state: LocalLinkState;
  message?: string;
  written?: VersionPair;
}

const STATE_FILE = 'agent.json';

/** CLI 설정 폴더의 agent.json (권한 600) */
export class AgentStateStore {
  private readonly path: string;

  constructor(configDir: string) {
    this.path = join(configDir, STATE_FILE);
  }

  async load(): Promise<AgentState> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<AgentState>;
      return {
        deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : null,
        written: parsed.written && typeof parsed.written === 'object' ? parsed.written : {},
      };
    } catch {
      return { deviceId: null, written: {} };
    }
  }

  async save(state: AgentState): Promise<void> {
    await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 });
    await writeFile(this.path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await chmod(this.path, 0o600);
  }

  /** 이 PC의 등록과 기록을 지운다 (senv agent uninstall) */
  async clear(): Promise<void> {
    await this.save({ deviceId: null, written: {} });
  }
}

export async function runAgentCycle(
  context: CliContext,
  session: AgentSession = { notified: new Set() },
): Promise<void> {
  const store = new AgentStateStore(context.configDir);
  const state = await store.load();

  if (!state.deviceId) {
    const device = await unwrap(
      context.api.POST('/api/v1/agent/devices', { body: { name: context.hostname } }),
    );
    state.deviceId = device.id;
    await store.save(state);
    context.out.info(
      `이 PC를 "${device.name}"(으)로 등록했습니다. 대시보드의 "내 로컬 연결"에서 폴더를 연결하세요.`,
    );
  }

  let links: LocalLink[];
  try {
    links = (
      await unwrap(
        context.api.GET('/api/v1/agent/devices/{id}/links', {
          params: { path: { id: state.deviceId } },
        }),
      )
    ).links;
  } catch (error) {
    if (error instanceof SenvApiError && error.code === 'device_not_found') {
      await store.clear();
      context.out.warn('대시보드에서 이 PC가 지워졌습니다. 다음 확인 때 다시 등록합니다.');
      return;
    }
    throw error;
  }

  const ids = new Set(links.map((link) => link.id));
  for (const id of Object.keys(state.written)) {
    if (!ids.has(id)) delete state.written[id];
  }

  for (const link of links) {
    try {
      await handleLink(context, session, state, store, link);
    } catch (error) {
      if (isAuthError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      await report(context, link, { state: 'error', message }).catch(() => {});
    }
  }
  await store.save(state);
}

async function handleLink(
  context: CliContext,
  session: AgentSession,
  state: AgentState,
  store: AgentStateStore,
  link: LocalLink,
): Promise<void> {
  if (link.status === 'paused') return;
  let active = link;
  if (link.status === 'pending') {
    const approved = await askApproval(context, session, link);
    if (!approved) return;
    active = approved;
  }
  const outcome = await sync(context, state, store, active);
  await report(context, active, outcome);
}

/** 대시보드에서 만든 연결은 이 PC에서 승인해야 쓴다 (결정 61) */
async function askApproval(
  context: CliContext,
  session: AgentSession,
  link: LocalLink,
): Promise<LocalLink | null> {
  if (!context.interactive) {
    if (!session.notified.has(link.id)) {
      session.notified.add(link.id);
      context.out.warn(
        `${link.project} → ${link.path}: 대시보드에서 추가한 연결이 승인을 기다립니다. 이 PC에 쓰려면 senv link approve ${link.id}`,
      );
    }
    return null;
  }
  const output = await outputFor(link.path);
  const target = output ? join(link.path, output) : `${link.path} (senv.json 없음)`;
  const yes = await context.prompt.confirm(
    `대시보드에서 추가한 연결: ${link.project} 프로젝트의 local 값을 ${target}에 자동으로 쓸까요?`,
  );
  const params = { params: { path: { id: link.id } } };
  if (!yes) {
    await unwrap(context.api.POST('/api/v1/agent/links/{id}/reject', params));
    context.out.info(`${link.project} → ${link.path} 연결을 거절했습니다.`);
    return null;
  }
  return unwrap(context.api.POST('/api/v1/agent/links/{id}/approve', params));
}

async function outputFor(folder: string): Promise<string | null> {
  if (!existsSync(join(folder, CONFIG_FILE))) return null;
  return findProjectConfig(folder).then(
    (loaded) => loaded.config.output,
    () => null,
  );
}

async function sync(
  context: CliContext,
  state: AgentState,
  store: AgentStateStore,
  link: LocalLink,
): Promise<Outcome> {
  const folder = await inspectFolder(link);
  if ('state' in folder) return folder;
  const { root, config } = folder;

  const check = await checkOutput(root, config.output);
  if (check === 'not_ignored') {
    return {
      state: check,
      message: `${config.output}이(가) git에서 무시되지 않아 쓰지 않았습니다`,
    };
  }
  if (check === 'symlink') {
    return { state: check, message: `${config.output}이(가) 심볼릭 링크라 쓰지 않았습니다` };
  }

  const path = join(root, config.output);
  const decision = decideLocalWrite({
    remote: link.current,
    written: state.written[link.id] ?? null,
    file: await readValueFile(path),
    overwriteRequested: link.overwriteRequested,
  });
  if (decision.action === 'modified') {
    return {
      state: 'modified',
      message: `${config.output}을(를) 직접 고친 것 같아 덮어쓰지 않았습니다. 대시보드에서 덮어쓰기를 누르면 씁니다`,
    };
  }
  if (decision.action === 'skip') return { state: 'ok' };

  let delivered: Awaited<ReturnType<typeof fetchVariables>>;
  try {
    delivered = await fetchVariables(context, { ...folder, env: 'local' });
  } catch (error) {
    if (error instanceof ExposedSecretError) return { state: 'exposure', message: error.message };
    throw error;
  }
  const text = renderValueFile(config.format, delivered, context.now());
  await writeValueFile(path, text);
  const written = { version: delivered.version, sharedVersion: delivered.sharedVersion };
  state.written[link.id] = { ...written, hash: hashText(text) };
  await store.save(state);
  context.out.info(
    `${link.project}: local v${written.version} (shared v${written.sharedVersion}) → ${path}`,
  );
  return { state: 'ok', written };
}

/** 연결 경로가 그 프로젝트의 senv.json이 있는 폴더인지. 상위 폴더의 senv.json은 보지 않는다 */
async function inspectFolder(link: LocalLink): Promise<LoadedProjectConfig | Outcome> {
  let root: string;
  try {
    root = await realpath(link.path);
  } catch {
    return { state: 'no_config', message: `폴더가 없습니다: ${link.path}` };
  }
  if (!existsSync(join(root, CONFIG_FILE))) {
    return {
      state: 'no_config',
      message: `${CONFIG_FILE}이 없습니다. 그 폴더에서 senv init을 실행하세요`,
    };
  }
  try {
    const loaded = await findProjectConfig(root);
    if (loaded.config.project !== link.project) {
      return {
        state: 'project_mismatch',
        message: `${CONFIG_FILE}의 프로젝트가 ${loaded.config.project}입니다 (연결: ${link.project})`,
      };
    }
    return loaded;
  } catch (error) {
    if (error instanceof InvalidProjectConfigError) {
      return { state: 'no_config', message: `${CONFIG_FILE}이 올바르지 않습니다` };
    }
    throw error;
  }
}

/** 상태가 바뀌었거나 새로 썼을 때만 보고한다 (30초마다 같은 보고를 하지 않는다) */
async function report(context: CliContext, link: LocalLink, outcome: Outcome): Promise<void> {
  const unchanged =
    link.lastState?.state === outcome.state &&
    (link.lastState?.message ?? null) === (outcome.message ?? null);
  if (unchanged && !outcome.written) return;
  await unwrap(
    context.api.POST('/api/v1/agent/links/{id}/report', {
      params: { path: { id: link.id } },
      body: outcome,
    }),
  );
  if (outcome.state !== 'ok')
    context.out.warn(`${link.project} → ${link.path}: ${outcome.message}`);
}

function isAuthError(error: unknown): boolean {
  return (
    error instanceof NotLoggedInError || (error instanceof SenvApiError && error.status === 401)
  );
}
