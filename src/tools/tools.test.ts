/** 미니앱 도구를 실제 공개 데이터(public/data/v1)로 검증한다. */
import { describe, expect, it } from 'vitest';
import { kcData, ksData, meta, recallData } from '../test-utils/data';
import { searchKs, looksLikeKsCode } from './ks';
import { searchKc, shortDiv } from './kc';
import { searchRecall } from './recall';
import { SYNONYMS } from './synonyms';
import { kcCertUrl, ksUrl, recallUrl } from './links';

describe('공개 데이터', () => {
  it('meta.json: 스키마·건수·출처', () => {
    const m = meta();
    expect(m.schema).toBe('kats-superapp/data/v1');
    expect(m.counts.ks).toBe(33266);
    expect(m.counts.kcAll).toBeGreaterThan(150000);
    expect(m.sources['file:15131276'].basis).toBe('2024-09-13');
    expect(Object.keys(m.files)).toContain('ks.index.json');
  });
});

describe('③ KS 표준 찾기', () => {
  it('표준번호로 정확히 한 건', () => {
    const r = searchKs(ksData(), 'KS C IEC 60335-2-30');
    expect(r.hits[0].record.no).toBe('KSCIEC60335-2-30');
    expect(r.hits[0].reason).toBe('표준번호 일치');
    expect(r.total).toBe(1);
  });
  it('번호 일부(국제표준 번호)로도 찾는다', () => {
    expect(searchKs(ksData(), '60335-2-30').hits[0].record.label).toBe('KS C IEC 60335-2-30');
    expect(looksLikeKsCode('60598')).toBe(true);
    expect(looksLikeKsCode('전기난로')).toBe(false);
  });
  it('생활 용어(전기난로) → 표준명 표현(실내용 난방기)', () => {
    const r = searchKs(ksData(), '전기난로를');
    expect(r.expandedTerms).toContain('실내용 난방기');
    expect(r.hits.map((h) => h.record.no)).toContain('KSCIEC60335-2-30');
  });
  it('기본은 폐지 제외, 요청하면 포함', () => {
    expect(searchKs(ksData(), '62133', { limit: 50 }).hits.every((h) => h.record.status !== '폐지')).toBe(true);
    expect(searchKs(ksData(), '62133', { includeWithdrawn: true, limit: 50 }).hits.some((h) => h.record.status === '폐지')).toBe(true);
  });
  it('필터: 국제표준 인용 N, 부문', () => {
    const r = searchKs(ksData(), '완구', { intl: true, div: 'G' });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.record.intl && h.record.div === 'G')).toBe(true);
  });
  it('원문 링크는 e-나라표준인증 표준번호 검색', () => {
    expect(ksUrl('KSA0001')).toContain('s_ksNo=KSA0001');
  });
});

describe('② KC 인증', () => {
  it('제품명 → 품목 집계와 인증구분 분포', () => {
    const r = searchKc(kcData(), '유모차');
    expect(r.summary[0].row.productName).toBe('유모차');
    expect(shortDiv(r.summary[0].topDiv)).toContain('어린이제품안전특별법');
    expect(r.records.every((h) => h.url.includes('searchPop?certNum='))).toBe(true);
  });
  it('생활 용어(전기난로) → KC 품목(전기스토브·전기온풍기), 안전인증 대상', () => {
    const r = searchKc(kcData(), '전기난로');
    const names = r.summary.map((s) => s.row.productName);
    expect(names).toEqual(expect.arrayContaining(['전기스토브', '전기온풍기']));
    expect(shortDiv(r.summary[0].topDiv)).toContain('안전인증');
  });
  it('인증번호: 자료에 없어도 현재 상태 링크를 준다', () => {
    const r = searchKc(kcData(), 'XU070339-19001B 인증 상태');
    expect(r.certNum).toBe('XU070339-19001B');
    expect(r.certLookup?.url).toBe(kcCertUrl('XU070339-19001B'));
  });
  it('인증번호: 자료에 있으면 그 기록을 첫째로', () => {
    const some = kcData().records[123];
    const r = searchKc(kcData(), some.certNum);
    expect(r.certLookup?.found?.certNum).toBe(some.certNum);
    expect(r.records[0].record.certNum).toBe(some.certNum);
  });
  it('모델명(기호 무시)으로 찾는다', () => {
    const rec = kcData().records.find((r) => /^[A-Z]{2,}-?\d{3,}/.test(r.modelName))!;
    const r = searchKc(kcData(), rec.modelName.replace('-', ''));
    expect(r.records.some((h) => h.record.certNum === rec.certNum)).toBe(true);
  });
});

describe('② 리콜', () => {
  it('제품명 + 동의어(제품명 필드에만)', () => {
    const r = searchRecall(recallData(), '보조배터리');
    expect(r.total).toBeGreaterThan(0);
    expect(r.total).toBeLessThan(150); // 위해 설명문의 '전지'까지 끌어오지 않음
    expect(r.hits[0].record.productName).toContain('보조배터리');
  });
  it('종류 필터와 원문 링크', () => {
    const r = searchRecall(recallData(), '유모차', { kinds: ['domestic'] });
    expect(r.hits.every((h) => h.record.kind === 'domestic')).toBe(true);
    expect(recallUrl('domestic', '10023056')).toContain('recallUid=10023056');
    expect(recallUrl('foreign')).toContain('fRecallBoard');
  });
});

describe('생활 용어 대응표', () => {
  it('모든 대응어가 실제 데이터(KS 표준명·KC 품목명·리콜 제품명)에 있다', () => {
    const n = (s: string) => s.toLowerCase().replace(/\s+/g, '');
    const ks = ksData().records.map((r) => n(r.name));
    const kc = kcData().summary.map((r) => n(r.productName));
    const rc = recallData().records.map((r) => n(`${r.productName} ${r.categoryName ?? ''}`));
    const missing: string[] = [];
    for (const g of SYNONYMS) {
      for (const w of g.ks) if (!ks.some((x) => x.includes(n(w)))) missing.push(`ks:${w}`);
      for (const w of g.kc) if (!kc.some((x) => x.includes(n(w)))) missing.push(`kc:${w}`);
      for (const w of g.recall) if (!rc.some((x) => x.includes(n(w)))) missing.push(`recall:${w}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('인증구분 표기', () => {
  it.each([
    ['전기용품및생활용품안전관리법대상>안전인증대상전기용품', '전기생활용품안전법 · 안전인증 대상 전기용품'],
    ['어린이제품특별법대상>안전확인대상', '어린이제품안전특별법 · 안전확인 대상'],
    ['전기용품 및 생활용품 안전관리법 대상>안전확인대상 생활용품', '전기생활용품안전법 · 안전확인 대상 생활용품'],
    ['품질경영및공산품안전관리법대상>자율안전확인대상', '(구)품질경영및공산품안전관리법 · 자율안전확인 대상'],
  ])('%s', (raw, want) => expect(shortDiv(raw)).toBe(want));
});
