/**
 * 공식 원문 링크 — 2026-11-05 에 실제로 열리는 것을 확인한 주소 형식만 쓴다.
 *  - KC 인증 상세: 제품안전정보센터 인증정보 팝업 (키 불필요, Open API 명세서 v2.1 5장 'URL 링크')
 *  - 국내 리콜 상세: recallUid 가 있을 때만 (Open API 수집분)
 *  - KS: e-나라표준인증 표준 검색 (표준번호로 정확히 1건)
 */
export const OFFICIAL = {
  safetyKorea: 'https://www.safetykorea.kr/',
  kcSearch: 'https://www.safetykorea.kr/release/certificationsearch',
  recallBoard: 'https://www.safetykorea.kr/recall/recallBoard',
  fRecallBoard: 'https://www.safetykorea.kr/recall/fRecallBoard',
  overseasBoard: 'https://www.safetykorea.kr/recall/overseasBoard',
  safetyTargets: 'https://www.safetykorea.kr/policy/targetsSafetyCert',
  ksPortal: 'https://standard.go.kr/',
  ksSearch: 'https://standard.go.kr/KSCI/standardIntro/getStandardSearchList.do?menuId=919&topMenuId=502&upperMenuId=503',
  knowTbt: 'https://www.knowtbt.kr/',
  kats: 'https://www.kats.go.kr/',
  dataGoKr: 'https://www.data.go.kr/',
} as const;

export const CONTACTS = [
  { name: '인증표준정보센터', tel: '1381', note: 'KS·인증제도 상담' },
  { name: '제품안전 민원 콜센터', tel: '1670-4920', note: 'KC 인증·리콜·제품안전 민원' },
] as const;

export function kcCertUrl(certNum: string): string {
  return `https://www.safetykorea.kr/search/searchPop?certNum=${encodeURIComponent(certNum.trim())}`;
}

export function recallUrl(kind: 'domestic' | 'foreign' | 'overseas', uid?: string): string {
  if (kind === 'domestic' && uid) return `https://www.safetykorea.kr/recall/ajax/recallBoard?recallUid=${encodeURIComponent(uid)}`;
  return kind === 'domestic' ? OFFICIAL.recallBoard : kind === 'foreign' ? OFFICIAL.fRecallBoard : OFFICIAL.overseasBoard;
}

export function ksUrl(no: string): string {
  return `${OFFICIAL.ksSearch}&search_gubun=1&s_ksNo=${encodeURIComponent(no.replace(/\s+/g, ''))}`;
}
