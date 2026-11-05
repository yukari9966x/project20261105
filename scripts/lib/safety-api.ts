/**
 * 제품안전정보센터 Open API (인터페이스 설계서 v2.1, 2026-10-16) 호출 도우미.
 *  - 인증: HTTP 헤더 AuthKey = 발급받은 서비스 ID (대소문자 구분)
 *  - 모든 조회 목록은 최대 1,000줄 → 날짜 조건(yyyyMMdd)으로 하루씩 나눠 받는다
 *  - 결과코드: 2000 Success · 2004 No Data · 4000 Invalid Auth Key · 4001 Invalid IP · 4005 Invalid Parameter · 5000 Server Error
 */
import type { KcRecord, RecallRecord } from '../../src/data/types';
import { kcFromApi, recallFromDomesticApi, recallFromForeignApi, recallFromOverseasApi } from './safety';

export type Endpoint = 'kc' | 'recall' | 'fRecall' | 'overseas';

export const ENDPOINTS: Record<Endpoint, { path: string; dateKey: string; label: string }> = {
  kc: { path: 'cert/certificationList.json', dateKey: 'signDate', label: 'KC인증(등록일)' },
  recall: { path: 'recall/recallList.json', dateKey: 'publishDate', label: '국내리콜(공표일)' },
  fRecall: { path: 'recall/fRecallList.json', dateKey: 'publishDate', label: '국외리콜(공표일)' },
  overseas: { path: 'recall/overseasList.json', dateKey: 'publishDate', label: '해외직구 안전성조사(공표일)' },
};

export const MAX_ROWS = 1000;

export class ApiFatalError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

export interface ApiResult {
  code: string;
  rows: Record<string, unknown>[];
}

export function buildUrl(base: string, ep: Endpoint, conditionKey: string, conditionValue: string): string {
  const u = new URL(ENDPOINTS[ep].path, base.endsWith('/') ? base : base + '/');
  u.searchParams.set('conditionKey', conditionKey);
  u.searchParams.set('conditionValue', conditionValue);
  return u.toString();
}

/** 응답 본문 → 결과코드와 행 배열. 인증·IP 오류는 더 부르지 않도록 ApiFatalError 로 던진다. */
export function parseResponse(body: unknown): ApiResult {
  if (!body || typeof body !== 'object') throw new Error('응답이 JSON 객체가 아님');
  const b = body as Record<string, unknown>;
  const code = String(b.resultCode ?? '').trim();
  if (code === '4000') throw new ApiFatalError('인증키가 올바르지 않습니다 (4000 Invalid Auth Key)', code);
  if (code === '4001') throw new ApiFatalError('허용되지 않은 IP 입니다 (4001 Invalid IP) — 고정 IP 실행기(runner)가 필요할 수 있습니다', code);
  if (code === '2004') return { code, rows: [] };
  if (code !== '2000') throw new Error(`결과코드 ${code || '(없음)'}: ${String(b.resultMsg ?? '')}`.trim());
  const data = b.resultData;
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
  return { code, rows: rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') };
}

export function normalizeRows(ep: Endpoint, rows: Record<string, unknown>[]): { kc: KcRecord[]; recalls: RecallRecord[] } {
  if (ep === 'kc') return { kc: rows.map(kcFromApi).filter((r) => r.certNum), recalls: [] };
  const fn = ep === 'recall' ? recallFromDomesticApi : ep === 'fRecall' ? recallFromForeignApi : recallFromOverseasApi;
  return { kc: [], recalls: rows.map(fn).filter((r) => r.uid) };
}

/** 'yyyyMMdd' 날짜들 (from ≤ d ≤ to, 한국 날짜 기준) */
export function dayRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000);
  const cur = kst(from);
  cur.setUTCHours(0, 0, 0, 0);
  const end = kst(to);
  end.setUTCHours(0, 0, 0, 0);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10).replace(/-/g, ''));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function mergeKc(prev: KcRecord[], fresh: KcRecord[]): KcRecord[] {
  const m = new Map<string, KcRecord>();
  for (const r of prev) m.set(r.certNum, r);
  for (const r of fresh) m.set(r.certNum, r);
  return [...m.values()];
}

export function mergeRecalls(prev: RecallRecord[], fresh: RecallRecord[]): RecallRecord[] {
  const m = new Map<string, RecallRecord>();
  for (const r of prev) m.set(r.id, r);
  for (const r of fresh) m.set(r.id, r);
  return [...m.values()];
}
