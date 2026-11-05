/**
 * 제품안전 데이터 정규화 — 공공데이터포털 파일데이터(CSV)와 제품안전정보센터 Open API(v2.1) 응답을
 * 같은 공개 스키마(src/data/types.ts)로 맞춘다. 값은 바꾸지 않고(공백 정리만) 필드 이름만 맞춘다.
 */
import type { KcRecord, RecallRecord } from '../../src/data/types';
import { isoDate } from '../../src/lib/format';

const clean = (v: unknown): string => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
const nonEmpty = (v: unknown): string | undefined => {
  const c = clean(v);
  return c ? c : undefined;
};
/** 파일데이터의 'A>B>C' 분류 표기는 그대로 두되 '미상>미상>미상' 같은 값은 비운다 */
const place = (v: unknown): string => {
  const c = clean(v);
  return /^(미상>?)+$/.test(c) ? '' : c;
};

export const SRC = {
  kcFile: 'file:15040703',
  recallDomesticFile: 'file:15040696',
  recallForeignFile: 'file:15040707',
  api: 'api:safetykorea',
} as const;

// ---------------------------------------------------------------- 파일데이터 (CSV 머리글은 한글)
export function kcFromFile(r: Record<string, string>): KcRecord {
  return {
    certNum: clean(r['인증번호']),
    certState: clean(r['인증상태']),
    certDiv: clean(r['인증구분명']),
    certDate: isoDate(r['인증일자']),
    productName: clean(r['제품명']),
    modelName: clean(r['모델명']),
    categoryName: clean(r['제품분류코드명']),
    importDiv: clean(r['수입제조']),
    makerName: clean(r['제조사명']),
    makerCntryName: clean(r['제조사국가명']),
    importerName: clean(r['수입사명']),
    certChgDate: nonEmpty(r['인증변경일자']),
    certChgReason: nonEmpty(r['인증사유']),
    src: SRC.kcFile,
  };
}

export function recallFromDomesticFile(r: Record<string, string>, i: number): RecallRecord {
  return {
    id: `dom-f-${i}`,
    kind: 'domestic',
    productName: clean(r['제품명']),
    modelName: clean(r['모델명']),
    brandName: clean(r['브랜드명']).replace(/^-$/, ''),
    makerName: clean(r['제조사명']),
    makingCntryName: place(r['제조국가명']),
    recallCmpnyName: nonEmpty(r['리콜사업자명']),
    certNum: nonEmpty(r['인증번호']),
    recallTypeName: nonEmpty(r['리콜종류']),
    recallMeans: nonEmpty(r['리콜방법']),
    harmType: nonEmpty(r['위해유형']),
    categoryName: nonEmpty(r['법정제품분류']),
    publishDate: isoDate(r['등록일']),
    src: SRC.recallDomesticFile,
  };
}

export function recallFromForeignFile(r: Record<string, string>, i: number): RecallRecord {
  return {
    id: `for-f-${i}`,
    kind: 'foreign',
    productName: clean(r['리콜제품명']),
    modelName: clean(r['리콜모델명']).replace(/^미상$/, ''),
    brandName: clean(r['리콜브랜드명']).replace(/^미상$/, ''),
    makerName: clean(r['제조사명']).replace(/^미상$/, ''),
    makingCntryName: place(r['제조사국가명']),
    hazard: nonEmpty(r['안전기준위반내용']),
    consumerAction: nonEmpty(r['사고사례내용']),
    recallMeans: nonEmpty(r['공표문조치내용']),
    productDscr: nonEmpty(r['공표문리콜대상제품내용']),
    publishDate: isoDate(r['공표일자']),
    src: SRC.recallForeignFile,
  };
}

// ---------------------------------------------------------------- Open API (명세서 v2.1 필드 이름)
type Api = Record<string, unknown>;

export function kcFromApi(r: Api): KcRecord {
  return {
    certNum: clean(r.certNum),
    certState: clean(r.certState),
    certDiv: clean(r.certDiv),
    certDate: isoDate(clean(r.certDate)),
    productName: clean(r.productName),
    modelName: clean(r.modelName),
    categoryName: clean(r.categoryName),
    importDiv: clean(r.importDiv),
    makerName: clean(r.makerName),
    makerCntryName: clean(r.makerCntryName),
    importerName: clean(r.importerName),
    certChgDate: nonEmpty(isoDate(clean(r.certChgDate))),
    certChgReason: nonEmpty(r.certChgReason),
    brandName: nonEmpty(r.brandName),
    certOrganName: nonEmpty(r.certOrganName),
    firstCertNum: nonEmpty(r.firstCertNum),
    signDate: nonEmpty(isoDate(clean(r.signDate))),
    src: SRC.api,
  };
}

export function recallFromDomesticApi(r: Api): RecallRecord {
  const uid = clean(r.recallUid);
  return {
    id: `dom-a-${uid}`,
    kind: 'domestic',
    productName: clean(r.recallProductName),
    modelName: clean(r.recallModelName),
    brandName: clean(r.recallBrandName),
    makerName: clean(r.makerName),
    makingCntryName: place(r.makingCntryName) || place(r.makerCntryName),
    recallCmpnyName: nonEmpty(r.recallCmpnyName),
    certNum: nonEmpty(r.certNum),
    recallTypeName: nonEmpty(r.recallTypeName),
    recallMeans: nonEmpty(r.recallMeans),
    hazard: nonEmpty(r.harmDscr) ?? nonEmpty(r.accidentCaseDscr),
    consumerAction: nonEmpty(r.publishActionDscr),
    categoryName: nonEmpty(r.categoryName) ?? nonEmpty(r.productItemName),
    publishDate: isoDate(clean(r.publishDate)),
    uid,
    src: SRC.api,
  };
}

export function recallFromForeignApi(r: Api): RecallRecord {
  const uid = clean(r.fRecallUid);
  return {
    id: `for-a-${uid}`,
    kind: 'foreign',
    productName: clean(r.recallProductName),
    modelName: clean(r.recallModelName),
    brandName: clean(r.recallBrandName),
    makerName: clean(r.makerName),
    makingCntryName: place(r.makingCntryName),
    recallTypeName: nonEmpty(r.recallTypeName),
    recallMeans: nonEmpty(r.recallMeans) ?? nonEmpty(r.publishActionDscr),
    hazard: nonEmpty(r.violateDscr),
    consumerAction: nonEmpty(r.accidentCaseDscr),
    productDscr: nonEmpty(r.recallProductDscr),
    categoryName: nonEmpty([clean(r.recallPblshCntryName), clean(r.recallPblshOrgnName)].filter(Boolean).join(' · ')),
    publishDate: isoDate(clean(r.publishDate)),
    uid,
    src: SRC.api,
  };
}

export function recallFromOverseasApi(r: Api): RecallRecord {
  const uid = clean(r.overseasUid);
  return {
    id: `ovs-a-${uid}`,
    kind: 'overseas',
    productName: clean(r.productName),
    modelName: clean(r.modelName),
    brandName: clean(r.brandName),
    makerName: '',
    makingCntryName: place(r.makingCntryName),
    hazard: nonEmpty(r.harmDscr),
    consumerAction: nonEmpty(r.accidentCaseDscr),
    publishDate: isoDate(clean(r.publishDate)),
    uid,
    src: SRC.api,
  };
}

/** 같은 리콜이 파일데이터와 API 양쪽에 있으면 API(최신·uid 있음)를 남긴다 */
export function recallDedupKey(r: RecallRecord): string {
  const model = r.modelName.replace(/[^0-9A-Za-z가-힣]/g, '').toUpperCase();
  const prod = r.productName.replace(/[^0-9A-Za-z가-힣]/g, '');
  return `${r.kind}|${prod}|${model}|${r.publishDate}`;
}
