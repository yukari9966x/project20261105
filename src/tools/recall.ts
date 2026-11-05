/**
 * ② 리콜 조회 — 국내·국외 리콜과 해외직구 안전성조사 결과를 제품명·모델명·인증번호·회사명으로 찾는다.
 * 값은 원본 그대로이고, 결과마다 출처(src)와 제품안전정보센터 원문 링크를 붙인다.
 */
import type { RecallData } from '../data/load';
import type { RecallKind, RecallRecord } from '../data/types';
import { cleanQuery } from '../search/korean';
import { CERT_NUM_RE } from './kc';
import { recallUrl } from './links';
import { compactIncludes, coverageSearch } from './match';
import { expand } from './synonyms';

export interface RecallHit {
  record: RecallRecord;
  reason: string;
  url: string;
}

export interface RecallSearchOptions {
  kinds?: RecallKind[];
  limit?: number;
  /** YYYY-MM-DD 이후 공표분만 */
  since?: string;
}

export interface RecallSearchResult {
  query: string;
  hits: RecallHit[];
  total: number;
  byKind: Record<RecallKind, number>;
  expandedTerms: string[];
}

export const RECALL_KIND_LABEL: Record<RecallKind, string> = {
  domestic: '국내 리콜',
  foreign: '국외 리콜',
  overseas: '해외직구 안전성조사',
};

export function searchRecall(data: RecallData, rawQuery: string, opts: RecallSearchOptions = {}): RecallSearchResult {
  const query = cleanQuery(rawQuery);
  const found = new Map<number, { score: number; reason: string }>();
  const add = (i: number, score: number, reason: string) => {
    const prev = found.get(i);
    if (!prev || prev.score < score) found.set(i, { score, reason });
  };

  const cert = CERT_NUM_RE.exec(rawQuery)?.[1];
  if (cert) data.records.forEach((r, i) => r.certNum && compactIncludes(r.certNum, cert) && add(i, 1000, '인증번호 일치'));

  const modelTokens = query.split(/\s+/).filter((w) => /\d/.test(w) && /[A-Za-z]/.test(w) && w.replace(/[^0-9A-Za-z]/g, '').length >= 3);
  for (const m of modelTokens) data.records.forEach((r, i) => compactIncludes(r.modelName, m) && add(i, 500, `모델명에 '${m}' 포함`));

  const textQuery = query.replace(/\S*\d\S*/g, ' ').trim();
  if (/[가-힣a-zA-Z]{2,}/.test(textQuery)) {
    for (const s of coverageSearch(data.index, textQuery, 0.6, 400)) add(s.id, s.score, s.coverage >= 0.99 ? '제품·회사·위해 내용 일치' : '부분 일치');
  }
  const expandedTerms = expand(rawQuery, 'recall');
  for (const term of expandedTerms) for (const s of coverageSearch(data.index, term, 0.99, 400, ['product'])) add(s.id, s.score * 0.9, `생활 용어 → 리콜 제품명 '${term}'`);

  let hits: RecallHit[] = [...found.entries()].map(([i, v]) => {
    const r = data.records[i];
    return { record: r, reason: v.reason, url: recallUrl(r.kind, r.uid), _score: v.score } as RecallHit & { _score: number };
  });
  if (opts.kinds?.length) hits = hits.filter((h) => opts.kinds!.includes(h.record.kind));
  if (opts.since) hits = hits.filter((h) => h.record.publishDate >= opts.since!);
  // 점수가 비슷하면 최근 공표 순
  hits.sort((a, b) => {
    const sa = (a as RecallHit & { _score: number })._score;
    const sb = (b as RecallHit & { _score: number })._score;
    return Math.round(sb) - Math.round(sa) || b.record.publishDate.localeCompare(a.record.publishDate);
  });
  const byKind: Record<RecallKind, number> = { domestic: 0, foreign: 0, overseas: 0 };
  for (const h of hits) byKind[h.record.kind]++;
  const clean = hits.map(({ record, reason, url }) => ({ record, reason, url }));
  return { query, hits: clean.slice(0, opts.limit ?? 20), total: clean.length, byKind, expandedTerms };
}
