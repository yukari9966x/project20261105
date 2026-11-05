import { describe, expect, it } from 'vitest';
import { compactCode, queryTokens, tokenize } from './tokenize';
import { cleanQuery, stripParticle } from './korean';

describe('한글 2글자 토크나이저', () => {
  it('붙은 한글은 2글자씩 겹쳐 자른다', () => {
    expect(tokenize('전기난로')).toEqual(['전기', '기난', '난로']);
  });
  it('띄어쓰기만 다른 경우를 잇는 토큰을 넣는다 (전기 난로 → 기난)', () => {
    expect(tokenize('전기 난로')).toEqual(['전기', '기난', '난로']);
  });
  it('한 글자 낱말은 그대로 둔다', () => {
    expect(tokenize('솥')).toEqual(['솥']);
  });
  it('영문·숫자는 경계에서 나누고 기호로 이은 형태도 넣는다', () => {
    expect(tokenize('SU-779')).toEqual(['su', '779', 'su779']);
    expect(tokenize('KS C IEC 60335-2-30')).toEqual(['ks', 'c', 'iec', '60335', '2', '30', '60335230']);
  });
  it('검색어 토큰은 중복을 뺀다', () => {
    expect(queryTokens('난로 난로')).toEqual(['난로', '로난']);
  });
  it('표준번호 비교용 형태', () => {
    expect(compactCode('KS C IEC 60335-2-30')).toBe('KSCIEC60335230');
  });
});

describe('조사 떼기 (받침 규칙)', () => {
  it.each([
    ['전기난로를', '전기난로'],
    ['전기난로', '전기난로'],
    ['전기난로로', '전기난로'],
    ['보조배터리가', '보조배터리'],
    ['유모차의', '유모차'],
    ['완구에서', '완구'],
    ['냉장고와', '냉장고'],
    ['LED를', 'LED'],
    ['어린이', '어린이'],
    ['바나나', '바나나'],
    ['히어로', '히어로'],
  ])('%s → %s', (w, want) => expect(stripParticle(w)).toBe(want));
  it('검색어 전체를 다듬는다', () => {
    expect(cleanQuery('전기난로를 수입하려면?')).toBe('전기난로 수입하려면');
  });
});
