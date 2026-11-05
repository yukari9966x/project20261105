/** 도구 공통: MiniSearch 결과를 '검색어 토큰을 얼마나 담았나(coverage)'로 걸러 엉뚱한 부분 일치를 줄인다. */
import type MiniSearch from 'minisearch';
import type { SearchResult } from 'minisearch';
import { queryTokens } from '../search/tokenize';

export interface Scored {
  id: number;
  score: number;
  coverage: number;
}

/**
 * 한글 2글자 토큰은 OR 로 찾고, 검색어 토큰의 minCoverage 이상을 담은 문서만 남긴다.
 * (예: '전기난로' → 전기·기난·난로 중 2개 이상)
 */
export function coverageSearch(index: MiniSearch, query: string, minCoverage = 0.6, limit = 200, fields?: string[]): Scored[] {
  const toks = queryTokens(query);
  if (!toks.length) return [];
  const results: SearchResult[] = index.search(query, fields ? { fields } : undefined);
  const out: Scored[] = [];
  for (const r of results) {
    const matched = new Set(r.queryTerms);
    const coverage = toks.filter((t) => matched.has(t)).length / toks.length;
    if (coverage + 1e-9 >= minCoverage) out.push({ id: Number(r.id), score: r.score * (0.5 + coverage), coverage });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => b.coverage - a.coverage || b.score - a.score);
}

/** 기호·공백을 뺀 대문자 형태가 서로 포함되는지 (모델명·인증번호 대조용) */
export function compactIncludes(haystack: string, needle: string): boolean {
  const h = haystack.replace(/[^0-9A-Za-z가-힣]/g, '').toUpperCase();
  const n = needle.replace(/[^0-9A-Za-z가-힣]/g, '').toUpperCase();
  return n.length >= 3 && h.includes(n);
}
