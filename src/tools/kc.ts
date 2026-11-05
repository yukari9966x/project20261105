/**
 * ② KC 인증 조회 — 제품명·모델명·인증번호로 KC 인증 기록을 찾는다.
 * 인증 상태는 시간이 지나면 바뀌므로(예: 적합 → 개선명령) 모든 결과에 '자료 기준일'과
 * 제품안전정보센터의 현재 상태 링크를 함께 돌려준다. 값은 원본 그대로.
 */
import type { KcData } from '../data/load';
import type { KcRecord, KcSummaryRow } from '../data/types';
import { cleanQuery } from '../search/korean';
import { kcCertUrl } from './links';
import { compactIncludes, coverageSearch } from './match';
import { expand } from './synonyms';

export const CERT_NUM_RE = /\b([A-Z]{1,4}\d{2,}[A-Z0-9]*-\d{3,}[A-Z0-9]*(?:-[0-9A-Z]{1,3})*)\b/i;

export interface KcRecordHit {
  record: KcRecord;
  reason: string;
  url: string;
}

export interface KcSummaryHit {
  row: KcSummaryRow;
  reason: string;
  /** 가장 많은 인증구분 (예: '전기용품및생활용품안전관리법대상>안전인증대상전기용품') */
  topDiv: string;
  topDivShare: number;
}

export interface KcSearchResult {
  query: string;
  certNum: string | null;
  /** 인증번호로 물었을 때: 스냅샷에 있으면 그 기록, 없어도 현재 상태 링크는 준다 */
  certLookup: { certNum: string; url: string; found: KcRecord | null } | null;
  summary: KcSummaryHit[];
  records: KcRecordHit[];
  totalRecords: number;
  expandedTerms: string[];
}

export interface KcSearchOptions {
  limit?: number;
  summaryLimit?: number;
}

function topDiv(row: KcSummaryRow): [string, number] {
  const entries = Object.entries(row.divs).sort((a, b) => b[1] - a[1]);
  const [div, n] = entries[0] ?? ['', 0];
  return [div, row.total ? n / row.total : 0];
}

/** 인증구분 원문을 읽기 쉽게: '전기용품및생활용품안전관리법대상>안전인증대상전기용품' → '전기생활용품안전법 · 안전인증 대상 전기용품' */
export function shortDiv(div: string): string {
  const [law, kind = ''] = div.replace(/\s+/g, '').split('>');
  // 데이터의 실제 표기(공백 제거 후): 전기용품및생활용품안전관리법대상 · 어린이제품특별법대상 · 품질경영및공산품안전관리법대상 …
  const lawShort = law
    .replace(/^전기용품및생활용품안전관리법대상$/, '전기생활용품안전법')
    .replace(/^어린이제품(안전)?특별법대상$/, '어린이제품안전특별법')
    .replace(/^전기용품안전관리법대상$/, '(구)전기용품안전관리법')
    .replace(/^품질경영및공산품안전관리법대상$/, '(구)품질경영및공산품안전관리법')
    .replace(/대상$/, '');
  const kindShort = kind.replace(/대상/g, ' 대상 ').replace(/\s+/g, ' ').trim();
  return kindShort ? `${lawShort} · ${kindShort}` : lawShort;
}

export function searchKc(data: KcData, rawQuery: string, opts: KcSearchOptions = {}): KcSearchResult {
  const query = cleanQuery(rawQuery);
  const limit = opts.limit ?? 20;
  const certMatch = CERT_NUM_RE.exec(rawQuery);
  const certNum = certMatch ? certMatch[1].toUpperCase() : null;

  let certLookup: KcSearchResult['certLookup'] = null;
  const recordHits: KcRecordHit[] = [];
  const seen = new Set<string>();
  const push = (r: KcRecord, reason: string) => {
    if (seen.has(r.certNum)) return;
    seen.add(r.certNum);
    recordHits.push({ record: r, reason, url: kcCertUrl(r.certNum) });
  };

  if (certNum) {
    const found = data.records.find((r) => r.certNum.toUpperCase() === certNum) ?? null;
    certLookup = { certNum, url: kcCertUrl(certNum), found };
    if (found) push(found, '인증번호 일치');
    const base = certNum.replace(/[A-Z]$/, '');
    for (const r of data.records) if (r.certNum.toUpperCase().startsWith(base) && r.certNum.toUpperCase() !== certNum) push(r, '같은 계열 인증번호(파생·변경)');
  }

  const rest = certNum ? query.replace(new RegExp(certNum, 'i'), '').trim() : query;

  // 모델명: 영문·숫자가 섞인 낱말을 기호 없이 대조
  const modelTokens = rest.split(/\s+/).filter((w) => /\d/.test(w) && /[A-Za-z]/.test(w) && w.replace(/[^0-9A-Za-z]/g, '').length >= 3);
  for (const m of modelTokens) for (const r of data.records) if (compactIncludes(r.modelName, m)) push(r, `모델명에 '${m}' 포함`);

  // 제품명: 품목 집계(전량 기준)를 색인 검색 → 그 품목의 개별 인증(최근 자료)
  const summary: KcSummaryHit[] = [];
  const expandedTerms = expand(rawQuery, 'kc');
  const textQuery = rest.replace(/\S*\d\S*/g, ' ').trim();
  const sumIds = new Map<number, string>();
  if (/[가-힣a-zA-Z]{2,}/.test(textQuery)) for (const s of coverageSearch(data.summaryIndex, textQuery, 0.6)) if (!sumIds.has(s.id)) sumIds.set(s.id, s.coverage >= 0.99 ? '제품명 일치' : '제품명 부분 일치');
  for (const term of expandedTerms) for (const s of coverageSearch(data.summaryIndex, term, 0.99, 200, ['product'])) if (!sumIds.has(s.id)) sumIds.set(s.id, `생활 용어 → 품목명 '${term}'`);
  for (const [id, reason] of sumIds) {
    const row = data.summary[id];
    const [div, share] = topDiv(row);
    summary.push({ row, reason, topDiv: div, topDivShare: share });
  }
  summary.sort((a, b) => b.row.total - a.row.total);
  const products = new Set(summary.slice(0, 12).map((s) => s.row.productName));
  const productRecords = data.records.filter((r) => products.has(r.productName));
  productRecords.sort((a, b) => (b.signDate || b.certDate).localeCompare(a.signDate || a.certDate));
  for (const r of productRecords) push(r, `제품명 '${r.productName}'`);

  // 회사명(제조·수입사)으로 물었을 때
  if (!recordHits.length && /[가-힣A-Za-z]{2,}/.test(textQuery)) {
    for (const r of data.records) if (compactIncludes(r.makerName + ' ' + r.importerName, textQuery)) push(r, '제조·수입사명 일치');
  }

  return {
    query,
    certNum,
    certLookup,
    summary: summary.slice(0, opts.summaryLimit ?? 8),
    records: recordHits.slice(0, limit),
    totalRecords: recordHits.length,
    expandedTerms,
  };
}
