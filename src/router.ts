/** 해시 라우팅 (#/, #/kc, #/ks, #/diff, #/about, #/settings). 쿼리는 #/kc?q=전기난로 처럼 해시 안에 둔다. */
import { useEffect, useState } from 'react';

export type RoutePath = '/' | '/kc' | '/ks' | '/diff' | '/about' | '/settings';
const KNOWN: RoutePath[] = ['/', '/kc', '/ks', '/diff', '/about', '/settings'];

export interface Route {
  path: RoutePath;
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [p, q = ''] = raw.split('?');
  const path = (KNOWN.includes(p as RoutePath) ? p : '/') as RoutePath;
  return { path, params: new URLSearchParams(q) };
}

export function href(path: RoutePath, params?: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v) q.set(k, v);
  const qs = q.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export function navigate(path: RoutePath, params?: Record<string, string | undefined>, replace = false): void {
  const next = href(path, params);
  if (replace) history.replaceState(null, '', next);
  else if (location.hash !== next) location.hash = next;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
