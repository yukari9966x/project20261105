/** OpenAI 호환 LLM 연결을 모의 서버(fetch 대체)로 검증 — 도구 호출 순환, 키 전송 범위, 함수 호출 미지원 대체, 변경체크 프롬프트. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loaders } from '../test-utils/data';
import { askWithLlm } from './agent';
import { buildMessages, summarizeChanges } from './diff';
import { chat, LlmError } from './client';
import type { LlmSettings } from './settings';

const S: LlmSettings = { mode: 'user', providerId: 'custom', baseUrl: 'https://llm.example.test/v1/', model: 'test-model', apiKey: 'sk-test', jsonMode: true, remember: false };

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
function mockFetch(responder: (body: Record<string, unknown>, n: number) => { status?: number; json?: unknown; text?: string }) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}'));
    calls.push({ url, body, headers: init.headers as Record<string, string> });
    const r = responder(body, calls.length);
    const status = r.status ?? 200;
    return new Response(r.text ?? JSON.stringify(r.json), { status, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('LLM 클라이언트', () => {
  it('설정한 주소로만, Bearer 키와 함께 보낸다', async () => {
    const calls = mockFetch(() => ({ json: { choices: [{ message: { role: 'assistant', content: '확인' } }] } }));
    const r = await chat(S, [{ role: 'user', content: 'ping' }], { json: true });
    expect(r.message.content).toBe('확인');
    expect(calls[0].url).toBe('https://llm.example.test/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBe('Bearer sk-test');
    expect(calls[0].body.response_format).toEqual({ type: 'json_object' });
  });
  it('인증 오류는 재시도하지 않는다', async () => {
    const calls = mockFetch(() => ({ status: 401, text: 'bad key' }));
    await expect(chat(S, [{ role: 'user', content: 'x' }])).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toHaveLength(1);
  });
});

describe('질문창 AI 모드 (도구 호출)', () => {
  it('LLM 이 search_kc 를 부르면 실제 도구 결과(원본값·근거 번호)를 돌려주고 카드도 만든다', async () => {
    const calls = mockFetch((body, n) => {
      if (n === 1) return { json: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'search_kc', arguments: '{"query":"유모차"}' } }] } }], usage: { total_tokens: 100 } } };
      const msgs = body.messages as { role: string; content: string }[];
      const tool = msgs.find((m) => m.role === 'tool')!;
      const data = JSON.parse(tool.content);
      expect(data.product_summary[0].product).toBe('유모차');
      expect(data.records[0].id).toBe('K1');
      return { json: { choices: [{ message: { role: 'assistant', content: '유모차는 어린이제품 안전확인 대상으로 등록되어 있습니다 [KC집계].' } }], usage: { total_tokens: 50 } } };
    });
    const a = await askWithLlm('유모차 KC 인증?', S, loaders, () => '2022.8.1 기준 공공데이터');
    expect(a.usedTools).toBe(true);
    expect(a.text).toContain('[KC집계]');
    expect(a.sections.map((s) => s.kind)).toEqual(['kc']);
    expect(a.usage).toEqual({ calls: 2, totalTokens: 150 });
    expect((calls[0].body.tools as unknown[]).length).toBe(4);
    expect(calls.every((c) => c.url.startsWith('https://llm.example.test/v1/'))).toBe(true);
  });

  it('함수 호출을 지원하지 않는 모델이면 규칙 검색 결과를 넘겨 요약만 받는다', async () => {
    mockFetch((body) => {
      if (body.tools) return { status: 400, text: '{"error":"tools are not supported by this model"}' };
      return { json: { choices: [{ message: { role: 'assistant', content: '요약' } }] } };
    });
    const a = await askWithLlm('보조배터리 리콜', S, loaders, () => '');
    expect(a.usedTools).toBe(false);
    expect(a.text).toBe('요약');
    expect(a.sections.some((s) => s.kind === 'recall')).toBe(true);
  });

  it('그 밖의 오류는 그대로 알린다', async () => {
    mockFetch(() => ({ status: 404, text: 'model not found' }));
    await expect(askWithLlm('유모차', S, loaders, () => '')).rejects.toBeInstanceOf(LlmError);
  });
});

describe('변경체크 AI 보강', () => {
  const target = { lookup_key: '제4조->제4조', alignment_id: 'a1', relationship: 'one_to_one', old_clauses: [{ number: '제4조', text: '500 mA 이하' }], new_clauses: [{ number: '제4조', text: '0.5 A 이하' }] };
  it('원본 엔진 프롬프트(v1)와 신뢰하지 않는 데이터 구분 태그를 쓴다', () => {
    const m = buildMessages(target, '2026-11-05');
    expect(m[0].content).toContain('프롬프트 버전: v1.0');
    expect(m[0].content).toContain('출력 JSON 스키마');
    expect(m[1].content).toContain('<UNTRUSTED_DOCUMENT_DATA>');
    expect(m[1].content).toContain('기준일: 2026-11-05');
  });
  it('조항별로 호출하고 실패는 오류 목록에 남긴다', async () => {
    mockFetch((_b, n) => (n === 2 ? { status: 400, text: 'bad' } : { json: { choices: [{ message: { role: 'assistant', content: '{"summary_ko":"요약"}' } }], usage: { total_tokens: 10 } } }));
    const r = await summarizeChanges([target, { ...target, lookup_key: '제5조->제5조' }], S, '2026-11-05', () => {}, undefined, 1);
    expect(Object.keys(r.outputs)).toEqual(['제4조->제4조']);
    expect(r.errors[0]).toContain('제5조->제5조');
    expect(r.calls).toBe(1);
  });
});
