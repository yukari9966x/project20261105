/**
 * check-vulns.ts — 의존성 취약점 검사 (OSV 공개 취약점 DB: 정부 AI 실험실 GitLab 의 OSV-Scanner·Trivy 가 쓰는 GHSA·PYSEC 포함)
 *
 *   npm run check:vulns        # 정부 GitLab 에 푸시하기 전에 같은 문제를 미리 찾는다
 *
 * 검사 대상
 *  - engine/requirements.txt         (Python — 보안 검사기가 읽는 파일)
 *  - 사이트에 실제로 넣는 Pyodide 패키지 (내장 패키지 버전은 node_modules/pyodide/pyodide-lock.json, 순수 휠은 scripts/lib/pyodide-packages.ts)
 *  - package-lock.json               (npm 전체)
 *
 * 알려진 취약점이 하나라도 있으면 실패(exit 1)하고, 고쳐야 할 최소 버전을 알려 준다.
 * OSV 에 연결하지 못하면 경고만 하고 넘어간다(VULN_CHECK_STRICT=1 이면 실패 — GitHub Actions 에서 사용).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_PACKAGES, PURE_WHEELS, canon } from './lib/pyodide-packages';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OSV = 'https://api.osv.dev/v1';

export interface Dep {
  ecosystem: 'PyPI' | 'npm';
  name: string;
  version: string;
  from: string;
}

/** requirements.txt 의 'name==version' 고정 줄만 읽는다 */
export function parseRequirements(text: string): { name: string; version: string }[] {
  const out: { name: string; version: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*==\s*([^\s;]+)/.exec(line);
    if (m) out.push({ name: canon(m[1]), version: m[2] });
  }
  return out;
}

/** package-lock.json(v2·v3) 의 설치 패키지 */
export function parseNpmLock(lock: { packages?: Record<string, { version?: string; name?: string; link?: boolean }> }): { name: string; version: string }[] {
  const out: { name: string; version: string }[] = [];
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    if (!path || meta.link || !meta.version) continue;
    out.push({ name: meta.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length), version: meta.version });
  }
  return out;
}

export function collectDeps(root = ROOT): Dep[] {
  const deps: Dep[] = [];
  for (const r of parseRequirements(readFileSync(join(root, 'engine', 'requirements.txt'), 'utf8'))) deps.push({ ecosystem: 'PyPI', ...r, from: 'engine/requirements.txt' });
  const lockPath = join(root, 'node_modules', 'pyodide', 'pyodide-lock.json');
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { packages: Record<string, { version: string }> };
    for (const n of BUILTIN_PACKAGES) if (lock.packages[n]) deps.push({ ecosystem: 'PyPI', name: canon(n), version: lock.packages[n].version, from: 'Pyodide 내장 패키지(사이트에 포함)' });
  }
  for (const w of PURE_WHEELS) deps.push({ ecosystem: 'PyPI', name: canon(w.name), version: w.version, from: 'Pyodide 휠(사이트에 포함)' });
  for (const r of parseNpmLock(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')))) deps.push({ ecosystem: 'npm', ...r, from: 'package-lock.json' });
  const seen = new Map<string, Dep>();
  for (const d of deps) {
    const k = `${d.ecosystem}|${d.name}|${d.version}`;
    if (!seen.has(k)) seen.set(k, d);
  }
  return [...seen.values()];
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw last;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface OsvVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  database_specific?: { severity?: string };
  affected?: { package?: { name?: string; ecosystem?: string }; ranges?: { events?: Record<string, string>[] }[] }[];
}

const verKey = (v: string) => v.split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
function maxVersion(vs: string[]): string | null {
  let best: string | null = null;
  for (const v of vs) {
    if (!best) best = v;
    else {
      const a = verKey(v);
      const b = verKey(best);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] ?? 0) !== (b[i] ?? 0)) {
          if ((a[i] ?? 0) > (b[i] ?? 0)) best = v;
          break;
        }
      }
    }
  }
  return best;
}

export async function check(deps: Dep[]): Promise<{ dep: Dep; vulns: OsvVuln[]; fixedIn: string | null }[]> {
  const hits: { dep: Dep; ids: string[] }[] = [];
  for (let i = 0; i < deps.length; i += 500) {
    const chunk = deps.slice(i, i + 500);
    const res = await post<{ results: { vulns?: { id: string }[] }[] }>(`${OSV}/querybatch`, {
      queries: chunk.map((d) => ({ package: { name: d.name, ecosystem: d.ecosystem }, version: d.version })),
    });
    res.results.forEach((r, j) => r.vulns?.length && hits.push({ dep: chunk[j], ids: r.vulns.map((v) => v.id) }));
  }
  const out: { dep: Dep; vulns: OsvVuln[]; fixedIn: string | null }[] = [];
  for (const h of hits) {
    const vulns = await Promise.all(h.ids.map((id) => get<OsvVuln>(`${OSV}/vulns/${encodeURIComponent(id)}`).catch(() => ({ id }) as OsvVuln)));
    const fixed: string[] = [];
    for (const v of vulns)
      for (const a of v.affected ?? [])
        if (canon(a.package?.name ?? '') === canon(h.dep.name)) for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) fixed.push(e.fixed);
    out.push({ dep: h.dep, vulns, fixedIn: maxVersion(fixed) });
  }
  return out;
}

async function main() {
  const deps = collectDeps();
  const strict = process.env.VULN_CHECK_STRICT === '1';
  console.log(`[check-vulns] 검사 대상 ${deps.length}개 (PyPI ${deps.filter((d) => d.ecosystem === 'PyPI').length} · npm ${deps.filter((d) => d.ecosystem === 'npm').length}) — OSV 공개 취약점 DB`);
  let found;
  try {
    found = await check(deps);
  } catch (e) {
    console.warn(`[check-vulns] OSV 에 연결하지 못했습니다: ${String(e)}`);
    process.exit(strict ? 2 : 0);
  }
  if (!found.length) {
    console.log('[check-vulns] 알려진 취약점 없음');
    return;
  }
  for (const f of found) {
    const sev = [...new Set(f.vulns.map((v) => v.database_specific?.severity).filter(Boolean))].join('/');
    console.error(`\n✗ ${f.dep.ecosystem} ${f.dep.name} ${f.dep.version} (${f.dep.from}) — 취약점 ${f.vulns.length}건${sev ? ` [${sev}]` : ''}${f.fixedIn ? ` → ${f.fixedIn} 이상으로 올리세요` : ''}`);
    for (const v of f.vulns.slice(0, 8)) console.error(`   - ${v.id}${v.aliases?.length ? ` (${v.aliases.slice(0, 2).join(', ')})` : ''}: ${v.summary ?? ''}`);
    if (f.vulns.length > 8) console.error(`   … 외 ${f.vulns.length - 8}건`);
  }
  console.error(`\n[check-vulns] 실패: ${found.length}개 패키지에 알려진 취약점이 있습니다. engine/requirements.txt 와 scripts/lib/pyodide-packages.ts(또는 package.json)를 함께 고치세요.`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
