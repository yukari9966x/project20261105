/**
 * 미니앱 = 도구. 화면·질문창이 쓰는 검색 함수를 그대로 LLM 함수 호출(tool calling) 도구로 내보낸다.
 * LLM 에는 원본값만 담은 짧은 JSON 을 주고(근거 번호 K1·R1·S1 …), 화면에는 같은 결과를 카드로 보여 준다.
 */
import type { Loaders, Section } from '../ask/answer';
import { kcLead, ksLead, recallLead } from '../ask/answer';
import type { RecallKind } from '../data/types';
import { CONTACTS } from './links';
import { searchKc, shortDiv } from './kc';
import { searchKs } from './ks';
import { searchRecall } from './recall';

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export const TOOL_DEFS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'search_kc',
      description:
        'KC 인증(전기·생활용품·어린이제품의 안전인증/안전확인/공급자적합성확인) 기록과 품목별 인증구분 집계를 제품명·모델명·인증번호로 찾는다. 값은 공공데이터 원본이며 자료 기준일이 있다. 인증 상태는 바뀔 수 있으므로 url 로 현재 상태 확인을 안내할 것.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '제품명(예: 전기난로), 모델명 또는 인증번호' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_recall',
      description: '국내 리콜·국외 리콜·해외직구 안전성조사 결과를 제품명·모델명·인증번호·회사명으로 찾는다. 값은 원본 그대로.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '제품명·모델명·인증번호·회사명' },
          kind: { type: 'string', enum: ['domestic', 'foreign', 'overseas'], description: '생략하면 전체' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_ks',
      description: 'KS 국가표준 33,266건을 표준번호(예: KS C IEC 60335-2-30) 또는 표준명으로 찾는다. 생활 용어는 표준명 표현으로 넓혀 찾는다. 결과: 표준번호·표준명·최종고시상태·국제표준인용여부.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, include_withdrawn: { type: 'boolean', description: '폐지 표준 포함 (기본 false)' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: { name: 'get_contacts', description: '국가기술표준원 관련 전화 상담 창구', parameters: { type: 'object', properties: {} } },
  },
];

export interface ToolRun {
  name: string;
  args: Record<string, unknown>;
  section: Section | null;
  /** LLM 에 돌려줄 짧은 JSON */
  llmResult: unknown;
}

let counter = { K: 0, R: 0, S: 0 };
export function resetCitations() {
  counter = { K: 0, R: 0, S: 0 };
}
const cite = (k: 'K' | 'R' | 'S') => `${k}${++counter[k]}`;

export async function runTool(name: string, args: Record<string, unknown>, loaders: Loaders, basis: (src: string) => string): Promise<ToolRun> {
  const query = String(args.query ?? '').slice(0, 200);
  switch (name) {
    case 'search_kc': {
      const r = searchKc(await loaders.kc(), query, { limit: 6, summaryLimit: 5 });
      const records = r.records.map((h) => ({ id: cite('K'), certNum: h.record.certNum, certState: h.record.certState, certDate: h.record.certDate, certDiv: h.record.certDiv, productName: h.record.productName, modelName: h.record.modelName, makerName: h.record.makerName, importerName: h.record.importerName, basis: basis(h.record.src), url: h.url }));
      return {
        name,
        args,
        section: { kind: 'kc', title: '② KC 인증', lead: kcLead(r, query), result: r, query },
        llmResult: {
          cert_lookup: r.certLookup && { certNum: r.certLookup.certNum, found_in_snapshot: !!r.certLookup.found, current_status_url: r.certLookup.url },
          product_summary: r.summary.map((s) => ({ product: s.row.productName, category: s.row.categoryName, certifications: s.row.total, main_cert_type: shortDiv(s.topDiv), main_cert_type_share: Math.round(s.topDivShare * 100) + '%', states: s.row.states, basis: basis(s.row.src[0]) })),
          records,
          expanded_terms: r.expandedTerms,
          total_records: r.totalRecords,
        },
      };
    }
    case 'search_recall': {
      const kind = args.kind as RecallKind | undefined;
      const r = searchRecall(await loaders.recall(), query, { limit: 6, kinds: kind ? [kind] : undefined });
      return {
        name,
        args,
        section: { kind: 'recall', title: '② 리콜', lead: recallLead(r, query), result: r, query },
        llmResult: {
          total: r.total,
          by_kind: r.byKind,
          hits: r.hits.map((h) => ({ id: cite('R'), kind: h.record.kind, publishDate: h.record.publishDate, productName: h.record.productName, modelName: h.record.modelName, brandName: h.record.brandName, hazard: h.record.hazard ?? h.record.harmType, action: h.record.recallMeans ?? h.record.consumerAction, basis: basis(h.record.src), url: h.url })),
          expanded_terms: r.expandedTerms,
        },
      };
    }
    case 'search_ks': {
      const r = searchKs(await loaders.ks(), query, { limit: 6, includeWithdrawn: Boolean(args.include_withdrawn) });
      return {
        name,
        args,
        section: { kind: 'ks', title: '③ KS 표준', lead: ksLead(r, query), result: r, query },
        llmResult: { total: r.total, hits: r.hits.map((h) => ({ id: cite('S'), no: h.record.label, name: h.record.name, status: h.record.status, international_standard_cited: h.record.intl, basis: basis('file:15131276'), url: h.url })), expanded_terms: r.expandedTerms },
      };
    }
    case 'get_contacts':
      return { name, args, section: { kind: 'contact', title: '상담 창구', lead: '전화로 묻고 싶을 때' }, llmResult: CONTACTS };
    default:
      return { name, args, section: null, llmResult: { error: `알 수 없는 도구: ${name}` } };
  }
}
