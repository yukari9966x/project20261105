/** 변경체크 엔진 코드값 → 화면 한국어 */
export const SEMANTIC_LABEL: Record<string, string> = {
  unchanged: '동일',
  format_only: '서식만 변경',
  changed: '변경',
  addition_candidate: '신설 후보',
  deletion_candidate: '삭제 후보',
  unresolved: '미해결',
};
export const SEMANTIC_TONE: Record<string, string> = {
  unchanged: 'outline',
  format_only: 'outline',
  changed: 'warn',
  addition_candidate: 'ok',
  deletion_candidate: 'bad',
  unresolved: 'info',
};
export const RELATION_LABEL: Record<string, string> = {
  one_to_one: '1:1',
  one_to_many: '분할 1→N',
  many_to_one: '병합 N→1',
  many_to_many: 'N:M',
  unmatched_old: '대응 없음(구판)',
  unmatched_new: '대응 없음(신판)',
};
export const FLAG_LABEL: Record<string, string> = {
  moved: '번호 이동',
  split: '분할',
  merged: '병합',
  repeated_number: '반복 번호',
  format_only: '서식만',
  unmatched: '미매칭',
  manual_edited: '수동 수정',
};
export const NUMERIC_LABEL: Record<string, string> = {
  numeric_equivalent: '수치 동등',
  tightened: '강화',
  relaxed: '완화',
  boundary_changed: '경계 변경',
  condition_changed_review: '조건 변경 · 검토',
  unit_unsupported_review: '단위 미지원 · 검토',
  value_changed_review: '값 변경 · 검토',
};
/** 값이 달라졌거나 검토가 필요한 수치 판정인지. '수치 동등'은 값이 그대로라는 뜻이라 변경으로 세지 않는다. */
export const isNumericChange = (d: { status: string }): boolean => d.status !== 'numeric_equivalent';

interface FactLike {
  raw_value: string;
  raw_unit: string;
  operator: string;
}
/** '수치 동등' 가운데 표기(값·단위·이상/이하)까지 같은 것 — 바뀐 것이 전혀 없는 숫자. (500 mA → 0.5 A 처럼 표기만 바뀐 것은 false) */
export function isSameNotation(d: { status: string; old_fact: FactLike | null; new_fact: FactLike | null }): boolean {
  if (d.status !== 'numeric_equivalent' || !d.old_fact || !d.new_fact) return false;
  return d.old_fact.raw_value === d.new_fact.raw_value && d.old_fact.raw_unit === d.new_fact.raw_unit && d.old_fact.operator === d.new_fact.operator;
}

/** 변경대조표 한 줄에 붙일 수치 판정 딱지 — 표기까지 같은 숫자는 빼고, 같은 판정은 '강화 ×4' 로 묶는다. */
export function numericBadges(deltas: { status: string; old_fact: FactLike | null; new_fact: FactLike | null }[]): { status: string; count: number }[] {
  const out: { status: string; count: number }[] = [];
  for (const d of deltas) {
    if (isSameNotation(d)) continue;
    const hit = out.find((b) => b.status === d.status);
    if (hit) hit.count++;
    else out.push({ status: d.status, count: 1 });
  }
  return out;
}

export const NUMERIC_TONE: Record<string, string> = {
  numeric_equivalent: 'ok',
  tightened: 'bad',
  relaxed: 'warn',
  boundary_changed: 'warn',
  condition_changed_review: 'info',
  unit_unsupported_review: 'info',
  value_changed_review: 'info',
};
export const DATE_ROLE_LABEL: Record<string, string> = {
  effective_date: '시행일',
  grace_period_end: '유예 종료일',
  manufacturing_date_basis: '제조일 기준',
  import_date_basis: '수입일 기준',
  promulgation_date: '공포일',
  relative_period: '상대 기한',
};
export const DATE_STATUS_LABEL: Record<string, string> = { confirmed: '확정', unconfirmed: '미확정', not_applicable: '해당 없음' };
export const REVIEW_LABEL: Record<string, string> = { unreviewed: '미검토', confirmed: '확인', modified: '수정 필요', rejected: '기각' };
export const REVIEW_TONE: Record<string, string> = { unreviewed: 'outline', confirmed: 'ok', modified: 'warn', rejected: 'bad' };
export const EVIDENCE_LABEL: Record<string, string> = { valid: '근거 확인', invalid: '근거 불일치', missing: '근거 없음' };
export const OP_LABEL: Record<string, string> = { lt: '미만', le: '이하', eq: '=', ge: '이상', gt: '초과', range: '범위', unknown: '?' };
