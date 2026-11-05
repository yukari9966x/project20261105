/**
 * ③ KS 표준 찾기 — 표준번호·표준명으로 KS 33,266건을 찾는다. 화면·질문창·LLM 도구가 같은 함수를 쓴다.
 * 값(표준번호·표준명·최종고시상태·국제표준인용여부)은 공공데이터 원본 그대로 돌려준다.
 */
import type { KsData } from '../data/load';
import type { KsRecord, KsStatus } from '../data/types';
import { cleanQuery } from '../search/korean';
import { ksUrl } from './links';
import { coverageSearch } from './match';
import { expand } from './synonyms';

export const KS_SOURCE = 'file:15131276';

export interface KsHit {
  record: KsRecord;
  score: number;
  reason: string;
  url: string;
}

export interface KsSearchOptions {
  /** 기본: 폐지 제외 */
  includeWithdrawn?: boolean;
  status?: KsStatus[];
  intl?: boolean;
  div?: string;
  limit?: number;
  /** 생활 용어 → 표준명 대응어로 넓혀 찾기 (기본 true) */
  expand?: boolean;
}

export interface KsSearchResult {
  query: string;
  hits: KsHit[];
  total: number;
  expandedTerms: string[];
  codeQuery: boolean;
}

const digitGroups = (s: string) => s.match(/\d+/g) ?? [];
const letters = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '').replace(/^KS/, '');

/** 표준번호처럼 보이는가 (숫자 3자리 이상이 있거나 KS 로 시작) */
export function looksLikeKsCode(q: string): boolean {
  const t = q.trim();
  return /^KS\s*[A-Z]/i.test(t) || (/\d{3,}/.test(t) && !/[가-힣]{2,}/.test(t));
}

function codeMatch(records: KsRecord[], query: string): KsHit[] {
  const qd = digitGroups(query);
  if (!qd.length) return [];
  const ql = letters(query.replace(/^\s*KS/i, ''));
  const qdKey = qd.join('-');
  const hits: KsHit[] = [];
  for (const r of records) {
    const rd = digitGroups(r.no);
    const rdKey = rd.join('-');
    if (rdKey !== qdKey && !rdKey.startsWith(qdKey + '-')) continue;
    const rl = letters(r.no);
    if (ql && !rl.includes(ql) && !rl.replace(/^[A-Z]/, '').includes(ql)) continue;
    const exact = rdKey === qdKey && (!ql || rl === ql || rl.slice(1) === ql);
    hits.push({ record: r, score: exact ? 100 : 70 - Math.min(20, rd.length - qd.length), reason: exact ? '표준번호 일치' : '표준번호 앞부분 일치', url: ksUrl(r.no) });
  }
  return hits;
}

const STATUS_ORDER: Record<string, number> = { 제정: 0, 개정: 0, 확인: 0, 폐지: 1 };

export function searchKs(data: KsData, rawQuery: string, opts: KsSearchOptions = {}): KsSearchResult {
  const query = cleanQuery(rawQuery);
  const limit = opts.limit ?? 20;
  const byId = new Map<number, KsHit>();
  const add = (i: number, hit: Omit<KsHit, 'record' | 'url'>) => {
    const r = data.records[i];
    const prev = byId.get(i);
    if (!prev || prev.score < hit.score) byId.set(i, { record: r, url: ksUrl(r.no), ...hit });
  };

  const codeQuery = looksLikeKsCode(query);
  if (codeQuery) {
    const idx = new Map(data.records.map((r, i) => [r.no, i]));
    for (const h of codeMatch(data.records, query)) add(idx.get(h.record.no)!, { score: h.score, reason: h.reason });
  }

  if (/[가-힣a-zA-Z]{2,}/.test(query)) {
    for (const s of coverageSearch(data.index, query, 0.6)) add(s.id, { score: s.score, reason: s.coverage >= 0.99 ? '표준명에 검색어 포함' : '표준명 부분 일치' });
  }

  const expandedTerms = opts.expand === false ? [] : expand(rawQuery, 'ks');
  for (const term of expandedTerms) {
    // 생활 용어로 묻는 사람은 대개 제품 안전을 찾으므로, 같은 표현이면 '안전' 표준(예: 60335 개별 요구사항)을 앞에 둔다
    for (const s of coverageSearch(data.index, term, 0.99)) add(s.id, { score: s.score * (data.records[s.id].name.includes('안전') ? 1 : 0.85), reason: `생활 용어 → 표준명 '${term}'` });
  }

  let hits = [...byId.values()];
  if (!opts.includeWithdrawn && !opts.status?.includes('폐지')) hits = hits.filter((h) => h.record.status !== '폐지');
  if (opts.status?.length) hits = hits.filter((h) => opts.status!.includes(h.record.status));
  if (opts.intl !== undefined) hits = hits.filter((h) => h.record.intl === opts.intl);
  if (opts.div) hits = hits.filter((h) => h.record.div === opts.div);
  hits.sort((a, b) => b.score - a.score || STATUS_ORDER[a.record.status] - STATUS_ORDER[b.record.status] || a.record.no.localeCompare(b.record.no));
  return { query, hits: hits.slice(0, limit), total: hits.length, expandedTerms, codeQuery };
}
