/** 변경체크 결과 화면의 수치 집계 — '수치 동등'(값 그대로)을 변경으로 세지 않는다. */
import { describe, expect, it } from 'vitest';
import { isNumericChange, isSameNotation, numericBadges } from './diffLabels';

const fact = (raw_value: string, raw_unit: string, operator = 'le') => ({ raw_value, raw_unit, operator });
const d = (status: string, o: ReturnType<typeof fact> | null, n: ReturnType<typeof fact> | null) => ({ status, old_fact: o, new_fact: n });

describe('수치 판정 집계', () => {
  const same = d('numeric_equivalent', fact('220', 'V', 'eq'), fact('220', 'V', 'eq')); // 숫자가 그대로
  const unit = d('numeric_equivalent', fact('500', 'mA'), fact('0.5', 'A')); // 단위 표기만 바뀜
  const tight = d('tightened', fact('10', 'mm'), fact('8', 'mm'));
  const boundary = d('boundary_changed', fact('10', 'mm', 'le'), fact('10', 'mm', 'lt'));

  it("'수치 동등'은 수치 변경이 아니고, 강화·완화·경계·검토는 수치 변경", () => {
    expect([same, unit].some(isNumericChange)).toBe(false);
    expect([tight, boundary, d('relaxed', null, null), d('value_changed_review', null, null), d('condition_changed_review', null, null)].every(isNumericChange)).toBe(true);
  });

  it('값·단위·이상/이하가 모두 같은 숫자만 "그대로"로 본다 (단위 환산은 남긴다)', () => {
    expect(isSameNotation(same)).toBe(true);
    expect(isSameNotation(unit)).toBe(false);
    expect(isSameNotation(boundary)).toBe(false);
    expect(isSameNotation(d('numeric_equivalent', null, fact('1', 'A')))).toBe(false);
  });

  it('딱지는 그대로인 숫자를 빼고 같은 판정을 묶는다', () => {
    expect(numericBadges([same, tight, unit, tight, same])).toEqual([
      { status: 'tightened', count: 2 },
      { status: 'numeric_equivalent', count: 1 },
    ]);
    expect(numericBadges([same])).toEqual([]);
  });
});
