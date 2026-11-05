import { describe, expect, it } from 'vitest';
import { loaders } from '../test-utils/data';
import { answerQuestion } from './answer';

describe('키 없음 모드 답변', () => {
  it('수입·판매 질문: 확인 순서 + KC·리콜·KS 블록, 문장은 데이터의 숫자·이름만', async () => {
    const a = await answerQuestion('전기난로를 수입해 팔려면 뭐가 필요해?', loaders);
    expect(a.sections.map((s) => s.kind)).toEqual(['steps', 'kc', 'recall', 'ks', 'contact']);
    const kc = a.sections.find((s) => s.kind === 'kc')!;
    expect(kc.lead).toMatch(/전기스토브 \d[\d,]*건/);
    expect(kc.lead).toContain('최종 판단은 제품안전정보센터');
    const ks = a.sections.find((s) => s.kind === 'ks')!;
    expect(ks.lead).toContain('KS C IEC');
    expect(a.headline).toContain('전기난로');
  });
  it('주제가 없으면 사용 안내', async () => {
    const a = await answerQuestion('안녕하세요', loaders);
    expect(a.sections[0].kind).toBe('empty');
  });
  it('인증번호 질문: 현재 상태 링크 문구', async () => {
    const a = await answerQuestion('XU070339-19001B 인증 상태', loaders);
    const kc = a.sections.find((s) => s.kind === 'kc')!;
    expect(kc.kind === 'kc' && kc.result.certLookup?.url).toContain('searchPop?certNum=XU070339-19001B');
  });
  it('수출 질문: 2단계 안내', async () => {
    const a = await answerQuestion('EU 배터리 규정 수출 준비', loaders);
    expect(a.sections.some((s) => s.kind === 'export')).toBe(true);
  });
});
