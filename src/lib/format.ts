/** 표기·날짜 도우미 (빌드 스크립트와 화면이 함께 쓴다) */

/** KS 부문 기호 → 부문명 (한국산업표준 21개 부문) */
export const KS_DIVISIONS: Record<string, string> = {
  A: '기본',
  B: '기계',
  C: '전기전자',
  D: '금속',
  E: '광산',
  F: '건설',
  G: '일용품',
  H: '식품',
  I: '환경',
  J: '생물',
  K: '섬유',
  L: '요업',
  M: '화학',
  P: '의료',
  Q: '품질경영',
  R: '수송기계',
  S: '서비스',
  T: '물류',
  V: '조선',
  W: '항공우주',
  X: '정보',
};

/** "KSCIEC60335-2-30" → "KS C IEC 60335-2-30", "KSXISOIEC11802-2" → "KS X ISO/IEC 11802-2" */
export function formatKsNo(no: string): string {
  const m = /^KS([A-Z_])(.*)$/.exec(no.trim());
  if (!m) return no;
  const [, div, rest] = m;
  const body = rest.replace(/^([A-Z/]+?)(?=\d)/, (prefix) => prefix.replace(/^ISOIEC/, 'ISO/IEC').replace(/^IECISO/, 'IEC/ISO') + ' ');
  return `KS ${div} ${body}`.replace(/\s+/g, ' ').trim();
}

/** "20240913" / "2024-09-13" / "2024.9.13" → "2024-09-13" (해석 불가면 원문) */
export function isoDate(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = String(raw).trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return s;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 시각 → "2026.11.3 06:00" (한국 시간). 날짜만 있으면 "2026.11.3" */
export function koDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number);
    return `${y}.${m}.${d}`;
  }
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const k = new Date(t + KST_OFFSET_MS);
  const hh = String(k.getUTCHours()).padStart(2, '0');
  const mm = String(k.getUTCMinutes()).padStart(2, '0');
  return `${k.getUTCFullYear()}.${k.getUTCMonth() + 1}.${k.getUTCDate()} ${hh}:${mm}`;
}

export function koDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = isoDate(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : d;
}

export function formatCount(n: number): string {
  return n.toLocaleString('ko-KR');
}

export function formatBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}
