/** 앱 틀 — 해시 라우팅(#/, #/kc, #/ks, #/diff, #/about, #/settings) */
import { lazy, Suspense, useEffect } from 'react';
import { href, useRoute, type RoutePath } from './router';
import { isLlmReady, modeLabel, useLlmSettings } from './llm/settings';
import { MetaProvider, useMeta } from './components/meta';
import { BrandMark, IconAsk, IconBook, IconDiff, IconInfo, IconShield } from './components/icons';
import { koDate } from './lib/format';
import { CONTACTS } from './tools/links';
import Ask from './pages/Ask';

const Kc = lazy(() => import('./pages/Kc'));
const Ks = lazy(() => import('./pages/Ks'));
const Diff = lazy(() => import('./pages/Diff'));
const About = lazy(() => import('./pages/About'));
const Settings = lazy(() => import('./pages/Settings'));

const NAV: { path: RoutePath; label: string; short: string; icon: typeof IconAsk }[] = [
  { path: '/', label: '질문', short: '질문', icon: IconAsk },
  { path: '/kc', label: 'KC·리콜', short: 'KC·리콜', icon: IconShield },
  { path: '/ks', label: 'KS 표준', short: 'KS', icon: IconBook },
  { path: '/diff', label: '변경체크', short: '변경체크', icon: IconDiff },
  { path: '/about', label: '안내', short: '안내', icon: IconInfo },
];

const TITLES: Record<RoutePath, string> = {
  '/': '질문',
  '/kc': 'KC 인증·리콜 조회',
  '/ks': 'KS 표준 찾기',
  '/diff': '해외규제 변경체크',
  '/about': '시제품 안내·출처',
  '/settings': 'AI 연결 설정',
};

function Footer() {
  const { meta } = useMeta();
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span>
          <strong>경진대회 시제품</strong> · 국가기술표준원 공식 서비스가 아닙니다 · 로그인 없음 · 개인정보를 받지 않습니다
        </span>
        <span>
          데이터: 공공데이터포털(국가기술표준원 제공, 이용허락 제한 없음){meta ? ` · KS ${koDate(meta.sources['file:15131276']?.basis)} · KC ${koDate(meta.sources['file:15040703']?.basis)} 기준` : ''}
          {meta?.api.fetchedAt ? ` · 제품안전 API ${koDate(meta.api.fetchedAt)} 수집` : ''}
        </span>
        <span>
          상담: {CONTACTS.map((c) => `${c.name} ${c.tel}`).join(' · ')} · <a href={href('/about')}>출처·데이터 JSON</a>
        </span>
      </div>
    </footer>
  );
}

export default function App() {
  const route = useRoute();
  const [settings] = useLlmSettings();
  const aiOn = isLlmReady(settings);

  useEffect(() => {
    document.title = `${TITLES[route.path]} · 국가기술표준원 슈퍼앱 (시제품)`;
    window.scrollTo({ top: 0 });
  }, [route.path]);

  let page;
  switch (route.path) {
    case '/kc':
      page = <Kc route={route} />;
      break;
    case '/ks':
      page = <Ks route={route} />;
      break;
    case '/diff':
      page = <Diff />;
      break;
    case '/about':
      page = <About />;
      break;
    case '/settings':
      page = <Settings />;
      break;
    default:
      page = <Ask route={route} />;
  }

  return (
    <MetaProvider>
      <a className="sr-only" href="#main">
        본문 바로가기
      </a>
      <div className="ribbon" role="note">
        <strong>경진대회 시제품</strong> · 국가기술표준원 공식 서비스가 아닙니다 · 사실은 공식 데이터 원본, 설명은 AI
      </div>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href={href('/')} aria-label="국가기술표준원 슈퍼앱 처음으로">
            <BrandMark className="brand-mark" />
            <span className="brand-text">
              <span className="brand-name">국가기술표준원 슈퍼앱</span>
              <span className="brand-sub">표준·인증·제품안전·해외규제 AI 통합창구</span>
            </span>
          </a>
          <nav className="nav" aria-label="주 메뉴">
            {NAV.map((n) => (
              <a key={n.path} href={href(n.path)} aria-current={route.path === n.path ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          <a className={`ai-pill ${aiOn ? 'on' : ''}`} href={href('/settings')} title={modeLabel(settings)} aria-current={route.path === '/settings' ? 'page' : undefined}>
            <span className="dot" aria-hidden="true" />
            <span>{aiOn ? 'AI 켜짐' : 'AI 꺼짐'}</span>
            {!aiOn && <span className="label" style={{ fontWeight: 500 }}>· 키 없음</span>}
            <span className="sr-only"> — AI 연결 설정</span>
          </a>
        </div>
      </header>
      <main id="main">
        <Suspense
          fallback={
            <div className="card row">
              <span className="spinner" /> 불러오는 중
            </div>
          }
        >
          {page}
        </Suspense>
      </main>
      <Footer />
      <nav className="tabbar" aria-label="하단 메뉴">
        {NAV.map((n) => (
          <a key={n.path} href={href(n.path)} aria-current={route.path === n.path ? 'page' : undefined}>
            <n.icon />
            {n.short}
          </a>
        ))}
      </nav>
    </MetaProvider>
  );
}
