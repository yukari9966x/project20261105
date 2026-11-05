import { describe, expect, it } from 'vitest';
import { parseQuestion, plan } from './intent';

describe('규칙 기반 의도 분류 (키 없음 모드)', () => {
  it('수입·판매 질문 → KC·리콜·KS·상담을 모두 부른다', () => {
    const p = parseQuestion('전기난로를 수입해 팔려면 뭐가 필요해?');
    expect(p.intents).toEqual(['import', 'sell']);
    expect(p.keywords).toEqual(['전기난로']);
    expect(plan(p)).toMatchObject({ kc: true, recall: true, ks: true, contact: true, diff: false });
  });
  it('리콜만 물으면 리콜만', () => {
    const p = parseQuestion('보조배터리 리콜 있었어?');
    expect(p.intents).toEqual(['recall']);
    expect(p.keywords).toEqual(['보조배터리']);
    expect(plan(p)).toMatchObject({ kc: false, recall: true, ks: false });
  });
  it('표준번호를 알아본다', () => {
    const p = parseQuestion('KS C IEC 60335-2-30 표준 상태 알려줘');
    expect(p.ksCode).toBe('KS C IEC 60335-2-30');
    expect(p.keywords).toEqual([]);
    expect(plan(p).ks).toBe(true);
  });
  it('인증번호 → KC·리콜', () => {
    const p = parseQuestion('XU070339-19001B 인증 상태');
    expect(p.certNum).toBe('XU070339-19001B');
    expect(plan(p)).toMatchObject({ kc: true, recall: true });
  });
  it('모델명은 따로 뽑는다', () => {
    const p = parseQuestion('SU-779 리콜 이력');
    expect(p.models).toEqual(['SU-779']);
  });
  it('규정 비교 → 변경체크 안내', () => {
    expect(plan(parseQuestion('구판 신판 규정 바뀐 곳 비교하고 싶어')).diff).toBe(true);
  });
  it('수출 → 2단계 안내 + 변경체크', () => {
    const p = parseQuestion('EU 배터리 규정 수출 준비');
    expect(plan(p)).toMatchObject({ exportGuide: true, diff: true });
  });
  it('조사·서술어·일반어를 키워드에서 뺀다', () => {
    expect(parseQuestion('중고거래로 어린이 카시트 팔아도 되나요').keywords).toEqual(['어린이', '카시트']);
    expect(parseQuestion('전동킥보드 해외직구 해도 돼?').keywords).toEqual(['전동킥보드']);
  });
  it('주제가 없으면 검색하지 않는다', () => {
    const p = parseQuestion('안녕하세요');
    expect(p.hasTopic).toBe(false);
    expect(plan(p)).toMatchObject({ kc: false, recall: false, ks: false });
  });
  it('상담만 물으면 상담 창구만', () => {
    expect(plan(parseQuestion('제품안전 상담 전화번호'))).toMatchObject({ contact: true, kc: false, ks: false });
  });
});
