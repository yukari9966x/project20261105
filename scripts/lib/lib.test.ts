import { describe, expect, it } from 'vitest';
import { csvObjects, parseCsv } from './csv';
import { kcFromApi, kcFromFile, recallDedupKey, recallFromDomesticApi, recallFromDomesticFile, recallFromForeignApi, recallFromOverseasApi } from './safety';
import { ApiFatalError, buildUrl, dayRange, mergeKc, parseResponse } from './safety-api';

describe('CSV', () => {
  it('따옴표 안 쉼표·줄바꿈·"" 와 BOM', () => {
    expect(parseCsv('﻿a,b\n"x, y","1\n2"\n"say ""hi""",3\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', '1\n2'],
      ['say "hi"', '3'],
    ]);
    expect(csvObjects('번호,이름\n1,가\n')).toEqual([{ 번호: '1', 이름: '가' }]);
  });
});

describe('제품안전 데이터 정규화 (값은 그대로, 필드 이름만 맞춤)', () => {
  it('KC 파일데이터 행', () => {
    const r = kcFromFile({ 인증번호: 'XU070339-19001B', 인증구분명: '전기용품및생활용품안전관리법대상>안전확인대상전기용품', 인증상태: '적합', 인증일자: '2019-10-01', 인증변경일자: '', 인증사유: '', 제품명: '초음파세척기', 모델명: 'SU-779', 제품분류코드명: '전기기기>전기세척기>초음파세척기', 수입제조: '수입', 제조사명: 'Foshan', 제조사국가명: '중국', 수입사명: '(주)제이에이치이원' });
    expect(r).toMatchObject({ certNum: 'XU070339-19001B', certState: '적합', certDate: '2019-10-01', modelName: 'SU-779', src: 'file:15040703' });
    expect(r.certChgDate).toBeUndefined();
  });
  it('KC Open API 응답(명세서 v2.1 예시)', () => {
    const r = kcFromApi({ certUid: 3512259, certOrganName: '한국화학융합시험연구원(KTR)', certNum: 'JU071047-12002C', certState: '적합', certDiv: '전기용품안전관리법 대상>자율안전확인 대상', certDate: '20130719', certChgDate: null, firstCertNum: 'JU071047-12002', productName: '관상어용히터', modelName: 'SH-100', importDiv: '수입', makerName: 'Zhong Shan', makerCntryName: '중국', importerName: 'Zhong Shan', signDate: '20181227' });
    expect(r).toMatchObject({ certNum: 'JU071047-12002C', certDate: '2013-07-19', signDate: '2018-12-27', certOrganName: '한국화학융합시험연구원(KTR)', src: 'api:safetykorea' });
  });
  it('국내 리콜 — 파일·API', () => {
    const f = recallFromDomesticFile({ 인증번호: 'CB063R4097-20001', 모델명: '하프토이MR-T002', 제품명: '완구', 브랜드명: '-', 사업자구분: '수입', 법정제품분류: '어린이>완구', 리콜종류: '명령에따른리콜', 리콜사업자명: '주식회사해브잇올', 제조국가명: '국외>아시아지역>중국', 제조사명: '', 제조사국가명: '미상>미상>미상', 리콜방법: '교환수거수리환불', 위해유형: '유해물질', 안전성조사명: '4', 등록일: '2020-09-22' }, 0);
    expect(f).toMatchObject({ kind: 'domestic', brandName: '', harmType: '유해물질', publishDate: '2020-09-22', makingCntryName: '국외>아시아지역>중국' });
    const a = recallFromDomesticApi({ recallUid: '3802', recallProductName: '가정용섬유제품(책가방)', recallModelName: 'HKAK31101S-00', recallTypeName: '명령에따른리콜', certNum: '공급자적합성', recallCmpnyName: '(주)이랜드월드패션사업부', makerName: '㈜이랜드', makingCntryName: '국외>아시아지역>중국', publishDate: '20130418', publishActionDscr: '수선 및 교환' });
    expect(a).toMatchObject({ id: 'dom-a-3802', uid: '3802', publishDate: '2013-04-18', consumerAction: '수선 및 교환' });
  });
  it('국외 리콜·해외직구 API', () => {
    expect(recallFromForeignApi({ fRecallUid: 77, recallProductName: '완구', violateDscr: '질식 위험', publishDate: '20200408' })).toMatchObject({ id: 'for-a-77', hazard: '질식 위험', publishDate: '2020-04-08' });
    expect(recallFromOverseasApi({ overseasUid: 5, productName: '코인 셀', harmDscr: '부적합', publishDate: '20260414' })).toMatchObject({ kind: 'overseas', uid: '5' });
  });
  it('파일·API 중복 판단 키', () => {
    const x = recallFromForeignApi({ fRecallUid: 1, recallProductName: '완구', recallModelName: 'AB-1', publishDate: '20200101' });
    expect(recallDedupKey(x)).toBe('foreign|완구|AB1|2020-01-01');
  });
});

describe('Open API 호출 도우미', () => {
  it('URL·결과코드', () => {
    expect(buildUrl('https://www.safetykorea.kr/openapi/api', 'recall', 'publishDate', '20261105')).toBe('https://www.safetykorea.kr/openapi/api/recall/recallList.json?conditionKey=publishDate&conditionValue=20261105');
    expect(parseResponse({ resultCode: '2004', resultMsg: 'No Data' }).rows).toEqual([]);
    expect(parseResponse({ resultCode: 2000, resultData: [{ a: 1 }] }).rows).toHaveLength(1);
    expect(() => parseResponse({ resultCode: '4000' })).toThrow(ApiFatalError);
    expect(() => parseResponse({ resultCode: '4001' })).toThrow(/IP/);
    expect(() => parseResponse({ resultCode: '5000', resultMsg: 'err' })).toThrow(/5000/);
  });
  it('한국 날짜 범위', () => {
    expect(dayRange(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-03T20:00:00Z'))).toEqual(['20261101', '20261102', '20261103', '20261104']);
  });
  it('인증번호 기준 병합 (새 값 우선)', () => {
    const a = kcFromApi({ certNum: 'A-1', certState: '적합' });
    const b = kcFromApi({ certNum: 'A-1', certState: '개선명령' });
    expect(mergeKc([a], [b])).toEqual([b]);
  });
});
