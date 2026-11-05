/**
 * 공개 데이터(/data/v1/*.json) 스키마. 다른 기관·AI 플랫폼이 그대로 가져다 쓸 수 있게 필드 이름은
 * 원 출처(제품안전정보센터 Open API 명세 v2.1, 공공데이터포털 CSV)의 이름을 따른다.
 */
export const SCHEMA_VERSION = 'kats-superapp/data/v1';

export type SourceKind = 'file' | 'api';

/** 데이터 출처 하나 (결과 카드의 '기준일 · 원문 링크'에 쓰인다) */
export interface SourceRef {
  id: string;
  kind: SourceKind;
  title: string;
  provider: string;
  url: string;
  license: string;
  /** 자료 기준일(파일데이터) 또는 수집 시각(API) — ISO 문자열 */
  basis: string;
  basisLabel: string;
  count: number;
  note?: string;
}

export interface Meta {
  schema: typeof SCHEMA_VERSION;
  generatedAt: string;
  sources: Record<string, SourceRef>;
  counts: { ks: number; kc: number; kcAll: number; recall: number; kcSummary: number };
  api: {
    status: 'ok' | 'partial' | 'no-key' | 'failed' | 'stale';
    fetchedAt: string | null;
    message: string;
  };
  files: Record<string, { path: string; bytes: number; sha256: string; description: string }>;
  notices: string[];
}

export type KsStatus = '제정' | '개정' | '확인' | '폐지';

export interface KsRecord {
  /** 한국산업표준번호 원본 (예: KSCIEC60335-2-30) */
  no: string;
  /** 읽기 쉬운 표기 (예: KS C IEC 60335-2-30) */
  label: string;
  /** 한글표준명 */
  name: string;
  /** 최종고시상태 */
  status: KsStatus;
  /** 국제표준인용여부 (Y → true) */
  intl: boolean;
  /** 부문 기호 (A~X) */
  div: string;
}

/** KC 인증 (필드 이름은 Open API certificationList 응답과 같음) */
export interface KcRecord {
  certNum: string;
  certState: string;
  certDiv: string;
  certDate: string;
  productName: string;
  modelName: string;
  categoryName: string;
  importDiv: string;
  makerName: string;
  makerCntryName: string;
  importerName: string;
  certChgDate?: string;
  certChgReason?: string;
  brandName?: string;
  certOrganName?: string;
  firstCertNum?: string;
  signDate?: string;
  /** 출처 id (meta.sources 의 키) */
  src: string;
}

/** 제품명별 KC 인증 집계 (파일데이터 전량 + API 수집분) */
export interface KcSummaryRow {
  productName: string;
  categoryName: string;
  total: number;
  divs: Record<string, number>;
  states: Record<string, number>;
  first: string;
  last: string;
  src: string[];
}

export type RecallKind = 'domestic' | 'foreign' | 'overseas';

/** 리콜 (국내·국외·해외직구). 값은 원 출처 그대로, 필드 이름만 한 벌로 맞춤 */
export interface RecallRecord {
  id: string;
  kind: RecallKind;
  productName: string;
  modelName: string;
  brandName: string;
  makerName: string;
  makingCntryName: string;
  recallCmpnyName?: string;
  certNum?: string;
  recallTypeName?: string;
  recallMeans?: string;
  /** 위해·결함 내용 (국내 harmDscr / 국외 violateDscr / 해외직구 harmDscr) */
  hazard?: string;
  /** 위해유형 (국내 파일데이터) */
  harmType?: string;
  /** 소비자 행동요령·조치사항 */
  consumerAction?: string;
  productDscr?: string;
  categoryName?: string;
  /** 공표일(API) 또는 등록일(국내 파일데이터) YYYY-MM-DD */
  publishDate: string;
  /** API 의 recallUid / fRecallUid / overseasUid */
  uid?: string;
  src: string;
}

export interface Dataset<T> {
  schema: typeof SCHEMA_VERSION;
  generatedAt: string;
  sources: string[];
  records: T[];
}
