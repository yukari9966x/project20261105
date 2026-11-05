/**
 * MiniSearch 색인 설정 — 빌드(scripts/build-index.ts)와 브라우저(loadJSON)가 반드시 같은 설정을 써야 한다.
 * 문서 id 는 해당 데이터 파일 records 배열의 순번(i)이다.
 *
 * 용량을 줄이려고 '말'은 색인하고 '번호'(표준번호·인증번호·모델명)는 색인하지 않는다.
 * 번호는 tools/ 에서 기호를 뺀 형태(compactCode)로 직접 대조하는 편이 더 정확하고 색인도 1/3 작아진다.
 */
import type { Options, SearchOptions } from 'minisearch';
import { tokenize } from './tokenize';
import type { KcSummaryRow, KsRecord, RecallRecord } from '../data/types';

type Doc = { i: number } & Record<string, string | number>;

const identity = (t: string) => t;

const prefixFor = (term: string) => term.length >= 3 && /^[a-z0-9]/.test(term);

export const SEARCH_DEFAULTS: SearchOptions = {
  combineWith: 'OR',
  prefix: prefixFor,
  fuzzy: false,
};

export const KS_INDEX: Options<Doc> = {
  idField: 'i',
  fields: ['name'],
  tokenize,
  processTerm: identity,
  searchOptions: { ...SEARCH_DEFAULTS },
};

/** KC 는 개별 인증(수만 건) 대신 제품명별 집계(약 3천 품목)를 색인한다 */
export const KC_SUMMARY_INDEX: Options<Doc> = {
  idField: 'i',
  fields: ['product', 'category'],
  tokenize,
  processTerm: identity,
  searchOptions: { ...SEARCH_DEFAULTS, boost: { product: 2, category: 0.6 } },
};

export const RECALL_INDEX: Options<Doc> = {
  idField: 'i',
  fields: ['product', 'model', 'company', 'text'],
  tokenize,
  processTerm: identity,
  searchOptions: { ...SEARCH_DEFAULTS, boost: { product: 2.5, model: 2.5, company: 1.2, text: 0.6 } },
};

export function ksDoc(r: KsRecord, i: number): Doc {
  return { i, name: r.name };
}

export function kcSummaryDoc(r: KcSummaryRow, i: number): Doc {
  return { i, product: r.productName, category: r.categoryName.split('>').slice(-2).join(' ') };
}

export function recallDoc(r: RecallRecord, i: number): Doc {
  return {
    i,
    product: [r.productName, r.categoryName].filter(Boolean).join(' '),
    model: [r.modelName, r.certNum].filter(Boolean).join(' '),
    company: [r.brandName, r.makerName, r.recallCmpnyName].filter(Boolean).join(' '),
    text: [r.harmType, r.hazard].filter(Boolean).join(' ').slice(0, 160),
  };
}
