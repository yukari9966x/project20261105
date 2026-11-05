/**
 * OpenAI 호환 /chat/completions 브라우저 클라이언트 (사용자 키 · 기관 LLM 공용).
 * 요청은 설정한 baseUrl 로만 보낸다. 키·문서 내용을 로그에 남기지 않는다.
 * 재시도: 최초 포함 최대 3회 (429·5xx·네트워크), Retry-After 를 따른다. 인증·모델 없음·잘못된 요청은 재시도하지 않는다.
 */
import type { LlmSettings } from './settings';
import type { ToolDef } from '../tools/registry';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatResult {
  message: ChatMessage;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  finishReason?: string;
}

export type LlmErrorKind = 'network' | 'auth' | 'not_found' | 'bad_request' | 'rate_limit' | 'server' | 'timeout' | 'invalid_output';

export class LlmError extends Error {
  constructor(
    public kind: LlmErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export function explainError(e: unknown): string {
  if (!(e instanceof LlmError)) return e instanceof Error ? e.message : String(e);
  switch (e.kind) {
    case 'network':
      return '연결하지 못했습니다. 주소가 맞는지, 서버가 브라우저 직접 호출(CORS)을 허용하는지 확인하세요. https 사이트에서는 http 주소(localhost 제외)를 부를 수 없습니다.';
    case 'auth':
      return 'API 키가 거부되었습니다(401/403). 키를 다시 확인하세요.';
    case 'not_found':
      return '모델 또는 주소를 찾을 수 없습니다(404). 모델 이름과 기본 주소(…/v1)를 확인하세요.';
    case 'rate_limit':
      return '요청 한도에 걸렸습니다(429). 잠시 뒤 다시 시도하세요.';
    case 'timeout':
      return '응답 시간이 초과되었습니다.';
    case 'bad_request':
      return `요청이 거부되었습니다(400): ${e.message}`;
    default:
      return e.message;
  }
}

const endpoint = (s: LlmSettings, path: string) => s.baseUrl.replace(/\/+$/, '') + path;

function headers(s: LlmSettings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s.apiKey) h.Authorization = `Bearer ${s.apiKey}`;
  return h;
}

async function request(s: LlmSettings, path: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  let lastErr: LlmError | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort('timeout'), timeoutMs);
    const onAbort = () => ctl.abort('cancel');
    signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetch(endpoint(s, path), { ...init, headers: { ...headers(s), ...(init.headers ?? {}) }, signal: ctl.signal });
      if (res.ok) return await res.json();
      const text = (await res.text().catch(() => '')).slice(0, 400);
      const kind: LlmErrorKind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 404 ? 'not_found' : res.status === 429 ? 'rate_limit' : res.status >= 500 ? 'server' : 'bad_request';
      lastErr = new LlmError(kind, text || `HTTP ${res.status}`, res.status);
      if (kind !== 'rate_limit' && kind !== 'server') throw lastErr;
      const retryAfter = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 20) * 1000 : 800 * 2 ** attempt + Math.random() * 300));
    } catch (err) {
      if (err instanceof LlmError && err.kind !== 'rate_limit' && err.kind !== 'server') throw err;
      if (signal?.aborted) throw new LlmError('network', '취소됨');
      if (ctl.signal.aborted && ctl.signal.reason === 'timeout') lastErr = new LlmError('timeout', '응답 시간 초과');
      else if (!(err instanceof LlmError)) lastErr = new LlmError('network', err instanceof Error ? err.message : String(err));
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr ?? new LlmError('network', '알 수 없는 오류');
}

export async function chat(
  s: LlmSettings,
  messages: ChatMessage[],
  opts: { tools?: ToolDef[]; json?: boolean; temperature?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ChatResult> {
  const body: Record<string, unknown> = { model: s.model, messages };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  if (opts.json && s.jsonMode) body.response_format = { type: 'json_object' };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  const data = (await request(s, '/chat/completions', { method: 'POST', body: JSON.stringify(body) }, opts.timeoutMs ?? 90000, opts.signal)) as {
    choices?: { message?: ChatMessage; finish_reason?: string }[];
    usage?: ChatResult['usage'];
  };
  const choice = data.choices?.[0];
  if (!choice?.message) throw new LlmError('invalid_output', '응답에 choices[0].message 가 없습니다.');
  return { message: choice.message, usage: data.usage, finishReason: choice.finish_reason };
}

export async function listModels(s: LlmSettings): Promise<string[]> {
  const data = (await request(s, '/models', { method: 'GET' }, 20000)) as { data?: { id: string }[]; models?: { name?: string; id?: string }[] };
  const ids = (data.data ?? []).map((m) => m.id).concat((data.models ?? []).map((m) => m.id ?? m.name ?? '')).filter(Boolean);
  return [...new Set(ids)].sort();
}

export async function ping(s: LlmSettings): Promise<{ ok: true; ms: number; reply: string }> {
  const t0 = performance.now();
  const r = await chat(s, [{ role: 'user', content: '연결 시험입니다. "확인"이라고만 답하세요.' }], { timeoutMs: 30000 });
  return { ok: true, ms: Math.round(performance.now() - t0), reply: (r.message.content ?? '').slice(0, 60) };
}
