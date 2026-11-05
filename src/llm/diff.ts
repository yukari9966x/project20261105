/**
 * ④ 변경체크 — 사용자 키/기관 LLM 모드: 바뀐 조항만 LLM 에 보내 요약·의무사항·불확실성을 보강한다.
 * 프롬프트·출력 스키마는 원본 엔진(kats-regulation-diff prompts/change_extract_v1.txt)을 그대로 쓰고,
 * 받은 JSON 은 엔진(apply_llm_outputs)이 검증·병합하며 인용문은 원문에서 다시 찾아 근거를 검증한다.
 */
import promptV1 from '../../engine/prompts/change_extract_v1.txt?raw';
import { chat } from './client';
import type { LlmSettings } from './settings';
import type { LlmTarget } from '../engine/types';

export const MAX_LLM_CALLS_PER_RUN = 100;

const SCHEMA_HINT = JSON.stringify({
  type: 'OBJECT',
  properties: {
    categories: { type: 'ARRAY', items: { type: 'STRING' } },
    semantic_status: { type: 'STRING', enum: ['unchanged', 'format_only', 'changed', 'addition_candidate', 'deletion_candidate', 'unresolved'] },
    summary_ko: { type: 'STRING' },
    old_fact: { type: 'STRING' },
    new_fact: { type: 'STRING' },
    changed_obligations: { type: 'ARRAY', items: { type: 'STRING' } },
    scope_conditions: { type: 'STRING' },
    uncertainties: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['categories', 'semantic_status', 'summary_ko', 'old_fact', 'new_fact', 'changed_obligations', 'scope_conditions', 'uncertainties'],
});

export function buildMessages(t: LlmTarget, targetDate: string) {
  const user =
    `작업명: extract_change\n기준일: ${targetDate}\n<UNTRUSTED_DOCUMENT_DATA>\n` +
    JSON.stringify({ old_clauses: t.old_clauses, new_clauses: t.new_clauses, relationship: t.relationship }) +
    '\n</UNTRUSTED_DOCUMENT_DATA>\n위 데이터를 분석하여 반드시 지정된 JSON 스키마 키(categories, semantic_status, summary_ko, old_fact, new_fact, changed_obligations, scope_conditions, uncertainties)를 포함한 단일 JSON 객체로만 응답하십시오.';
  return [
    { role: 'system' as const, content: `${promptV1}\n\n[출력 JSON 스키마 (OpenAPI 표기, 키 이름을 그대로 사용)]\n${SCHEMA_HINT}` },
    { role: 'user' as const, content: user },
  ];
}

export interface DiffLlmRun {
  outputs: Record<string, string>;
  errors: string[];
  calls: number;
  totalTokens: number | null;
}

export async function summarizeChanges(
  targets: LlmTarget[],
  settings: LlmSettings,
  targetDate: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
  concurrency = 3,
): Promise<DiffLlmRun> {
  const list = targets.slice(0, MAX_LLM_CALLS_PER_RUN);
  const outputs: Record<string, string> = {};
  const errors: string[] = [];
  let calls = 0;
  let tokens = 0;
  let hasTokens = false;
  let done = 0;
  let next = 0;
  async function worker() {
    while (next < list.length && !signal?.aborted) {
      const t = list[next++];
      try {
        const r = await chat(settings, buildMessages(t, targetDate), { json: true, temperature: 0.1, signal });
        calls++;
        if (r.usage?.total_tokens) {
          tokens += r.usage.total_tokens;
          hasTokens = true;
        }
        // 형식 검증·정규화는 엔진이 한다 (잘린 응답은 거부되어 '부분 완료'로 표시)
        outputs[t.lookup_key] = r.message.content ?? '';
      } catch (e) {
        errors.push(`${t.lookup_key}: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
      }
      onProgress(++done, list.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  if (targets.length > list.length) errors.push(`호출 상한(${MAX_LLM_CALLS_PER_RUN}건)을 넘는 ${targets.length - list.length}건은 보내지 않았습니다.`);
  return { outputs, errors, calls, totalTokens: hasTokens ? tokens : null };
}
