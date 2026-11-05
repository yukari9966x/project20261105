/** 화면용 단순 아이콘 (선 그림, currentColor). 기관 로고·인증 마크는 쓰지 않는다. */
import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p });

export const IconAsk = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 5h16v11H9l-5 4z" />
    <path d="M9 9.5h6M9 12.5h4" />
  </svg>
);
export const IconShield = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);
export const IconBook = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3z" />
    <path d="M5 17a3 3 0 013-3h10" />
  </svg>
);
export const IconDiff = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="7" height="16" rx="1.5" />
    <rect x="14" y="4" width="7" height="16" rx="1.5" />
    <path d="M5.5 9h2M5.5 12h2M16.5 9h2M16.5 12h2M16.5 15h2" />
  </svg>
);
export const IconInfo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);
export const IconExternal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
  </svg>
);

/** 작품 표식 — 표준·인증·안전 세 갈래를 한 창구로 묶는다는 뜻의 단순 도형 (기관 로고 아님) */
export function BrandMark(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 34 34" aria-hidden="true" {...p}>
      <rect x="1" y="1" width="32" height="32" rx="9" fill="var(--brand)" />
      <rect x="8" y="9" width="18" height="3.4" rx="1.7" fill="#fff" opacity="0.95" />
      <rect x="8" y="15.3" width="13" height="3.4" rx="1.7" fill="#fff" opacity="0.8" />
      <rect x="8" y="21.6" width="8" height="3.4" rx="1.7" fill="#fff" opacity="0.65" />
      <circle cx="24.5" cy="23.3" r="3.3" fill="var(--accent)" stroke="#fff" strokeWidth="1.4" />
    </svg>
  );
}
