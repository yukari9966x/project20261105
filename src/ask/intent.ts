/**
 * ① 질문창 — 키 없음(기본) 모드의 규칙 기반 의도 분류.
 * 질문에서 '무엇을 알고 싶은지(의도)'와 '무엇에 대해(제품·번호)'를 뽑아 어느 미니앱(도구)을 부를지 정한다.
 * AI 없이 동작하며, 분류 결과는 화면에 그대로 보여 주어 사용자가 고칠 수 있게 한다.
 */
import { CERT_NUM_RE } from '../tools/kc';
import { stripParticle } from '../search/korean';

export type Intent = 'import' | 'sell' | 'export' | 'kc' | 'recall' | 'ks' | 'diff' | 'contact';

export const INTENT_LABEL: Record<Intent, string> = {
  import: '수입 준비',
  sell: '판매·유통 준비',
  export: '수출·해외규제',
  kc: 'KC 인증',
  recall: '리콜',
  ks: 'KS 표준',
  diff: '규정 변경 대조',
  contact: '상담·문의처',
};

const RULES: [Intent, RegExp][] = [
  ['import', /수입|직구|들여(오|와|올)|해외에서\s*(사|구매|구입)|병행수입|구매대행/],
  ['sell', /판매|팔(려|고|면|아|기|수)|유통|출시|시판|납품|창업|온라인\s*몰|쇼핑몰|중고\s*거래|되팔/],
  ['export', /수출|해외\s*(판매|진출|시장)|TBT|무역기술장벽|기술규제|해외\s*규제|현지\s*인증/i],
  ['kc', /KC|인증|안전\s*확인|안전\s*인증|공급자\s*적합성|적합성\s*확인|인증\s*번호|인증\s*대상|인증\s*받/i],
  ['recall', /리콜|회수|결함|위해|사고|위험|안전한(지|가)|안전해|문제\s*(있|없)|불량|교환|환불/],
  ['ks', /KS|표준|규격|국가\s*표준|ISO|IEC/i],
  ['diff', /(규정|규제|고시|기술\s*기준|법령|규칙|지침|directive|regulation).{0,12}(비교|대조|바뀐|변경|개정|달라)|(비교|대조|바뀐|변경|개정).{0,8}(규정|규제|고시|기술\s*기준)|변경\s*체크|신판|구판|조항\s*(비교|대조)/i],
  ['contact', /전화|문의|상담|연락처|콜\s*센터|어디에\s*(물어|문의)/],
];

export const KS_CODE_RE = /\bKS\s*[A-Z](?:\s*(?:ISO\/IEC\/IEEE|ISO\/IEC|IEC\/IEEE|ISO|IEC|ITU|ASTM))?\s*[/]?\s*\d{1,6}(?:\s*[-:]\s*\d+)*/i;
const INTL_CODE_RE = /\b(?:IEC|ISO)\s*\d{3,6}(?:-\d+)*/i;

/** 질문에서 빼는 말 (의문사·서술어·일반 명사·의도 낱말) */
const STOP = new Set(
  (
    '뭐 뭐가 뭔가요 뭔지 무엇 무엇이 무엇을 어떤 어떻게 어디 어디서 어디에 언제 왜 누가 얼마나 몇 ' +
    '필요 필요해 필요해요 필요한 필요한가요 필요하나요 해야 해야해 해야하나요 해야돼 하나요 되나요 돼요 되는지 되는 ' +
    '있어 있어요 있나요 있는지 있었어 있었나요 있을까 없어 없나요 알려줘 알려주세요 알려 찾아줘 찾아 찾기 검색 확인 확인해줘 확인하고 ' +
    '궁금 궁금해 궁금해요 좀 혹시 그리고 또 및 등 것 거 게 건 걸 수 때 경우 위해 위한 대한 대해 대해서 관련 관련된 정보 여부 내용 ' +
    '가능 가능한가요 가능한지 받아야 받으려면 받나요 받아야해 받은 받았는지 하려면 려면 싶어 싶어요 싶은데 싶다 방법 절차 ' +
    '제품 상품 물건 우리 저희 회사 지금 요즘 최근 이 그 저 이거 저거 그거 이런 그런 같은 ' +
    '수입 수입해 수입하려면 수입할 수입하고 직구 판매 판매하려면 팔려면 팔면 팔고 유통 출시 수출 수출하려면 ' +
    '인증 인증서 인증번호 KC 리콜 회수 표준 규격 KS 국가표준 상태 이력 대상 기준 규정 규제 비교 대조 변경 바뀐 ' +
    '전화 문의 상담 연락처 안전 안전한지 문제 사고 위험 해외 국내 한국 국가 정부 ' +
    '해외직구 직구 해도 돼 되 되나 되나요 돼요 팔아도 사도 써도 중고 중고거래 거래 준비 모델 모델명 품명 제품명 번호 전화번호 ' +
    '제품안전 콜센터 구판 신판 곳 부분 조항 안녕 안녕하세요 감사 감사합니다 고마워 반가워 부탁 부탁해 부탁드려요 질문'
  ).split(/\s+/),
);

const PREDICATE_END = /(하려면|려면|하나요|되나요|인가요|있나요|없나요|할까요|해야|해요|해줘|줘요|싶어|싶은데|합니까|입니까|인지|한지|는지|을까|ㄹ까|나요|까요|어요|아요|해|돼|줘)$/;

export interface ParsedQuestion {
  question: string;
  intents: Intent[];
  keywords: string[];
  ksCode: string | null;
  certNum: string | null;
  models: string[];
  /** 질문이 제품·주제를 담고 있는가 (없으면 사용 안내를 보여 준다) */
  hasTopic: boolean;
}

export function parseQuestion(question: string): ParsedQuestion {
  const q = question.normalize('NFKC').trim();
  const intents: Intent[] = [];
  for (const [intent, re] of RULES) if (re.test(q)) intents.push(intent);

  const certNum = CERT_NUM_RE.exec(q)?.[1]?.toUpperCase() ?? null;
  const ksMatch = KS_CODE_RE.exec(q) ?? INTL_CODE_RE.exec(q);
  const ksCode = ksMatch ? ksMatch[0].replace(/\s+/g, ' ').trim() : null;

  let rest = q;
  if (certNum) rest = rest.replace(new RegExp(certNum.replace(/[-]/g, '\\-'), 'i'), ' ');
  if (ksMatch) rest = rest.replace(ksMatch[0], ' ');

  const models: string[] = [];
  const keywords: string[] = [];
  for (const raw of rest.split(/[\s,?!.·:;'"“”‘’()[\]{}<>~]+/)) {
    if (!raw) continue;
    if (/\d/.test(raw) && /[A-Za-z]/.test(raw) && raw.replace(/[^0-9A-Za-z]/g, '').length >= 3) {
      models.push(raw.replace(/[을를이가은는의에도로]$/, ''));
      continue;
    }
    let w = stripParticle(raw);
    if (STOP.has(w) || STOP.has(w.toUpperCase()) || STOP.has(raw)) continue;
    if (/^(KC|KS)/i.test(w) && w.length <= 6) continue;
    if (/^(수입|판매|수출|인증|리콜|표준|규격|문의|상담)/.test(w)) continue;
    if (/^팔(아|려|고|면|기|수)|^사(도|려|고)$|^(해도|써도|봐도)$/.test(w)) continue;
    if (PREDICATE_END.test(w) && !/[A-Za-z0-9]/.test(w)) {
      const stem = w.replace(PREDICATE_END, '');
      if (stem.length < 2 || STOP.has(stem)) continue;
      w = stem;
    }
    if (w.length < 2 && !/[A-Za-z0-9]/.test(w)) continue;
    if (!keywords.includes(w)) keywords.push(w);
  }

  if (certNum) for (const i of ['kc', 'recall'] as Intent[]) if (!intents.includes(i)) intents.push(i);
  if (ksCode && !intents.includes('ks')) intents.push('ks');
  if (models.length) for (const i of ['kc', 'recall'] as Intent[]) if (!intents.includes(i)) intents.push(i);

  return { question: q, intents, keywords, ksCode, certNum, models, hasTopic: keywords.length > 0 || !!certNum || !!ksCode || models.length > 0 };
}

/** 어떤 미니앱(도구)을 부를지 */
export function plan(p: ParsedQuestion): { kc: boolean; recall: boolean; ks: boolean; diff: boolean; contact: boolean; exportGuide: boolean } {
  const has = (i: Intent) => p.intents.includes(i);
  const broad = has('import') || has('sell');
  const none = !p.intents.some((i) => i !== 'contact');
  const topic = p.keywords.length > 0 || p.models.length > 0 || !!p.certNum;
  return {
    kc: (has('kc') || broad || (none && topic)) && topic,
    recall: (has('recall') || broad || (none && topic) || has('kc')) && topic,
    ks: (has('ks') || broad || (none && p.keywords.length > 0)) && (p.keywords.length > 0 || !!p.ksCode),
    diff: has('diff') || has('export'),
    contact: has('contact') || broad,
    exportGuide: has('export'),
  };
}
