/**
 * copy-pyodide.ts — 변경체크 엔진이 브라우저에서 돌 수 있도록 필요한 Pyodide 파일만 사이트에 넣는다(자체 호스팅).
 *
 *  1) node_modules/pyodide 의 코어 파일(wasm·stdlib·로더)
 *  2) Pyodide 내장 패키지 중 엔진에 필요한 것만(lxml·pydantic·micropip …) — CDN 에서 받아 sha256 검증
 *  3) micropip 로 설치할 순수 Python 휠(pypdf·python-docx·openpyxl·et-xmlfile·defusedxml) — PyPI 에서 받아 sha256 검증
 *  4) engine/kats_diff 파이썬 소스 묶음(JSON) + 내장 샘플 4쌍
 *
 * 결과: public/pyodide/, public/engine/, public/samples/ (빌드 때 dist/ 로 복사됨)
 * 인터넷이 막힌 CI(기관 내부망)에서는 vendor/pyodide/ 에 같은 파일을 미리 넣어 두면 내려받지 않는다.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_PACKAGES, PURE_WHEELS, canon } from './lib/pyodide-packages';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PYODIDE_PKG = join(ROOT, 'node_modules', 'pyodide');
const OUT_PY = join(ROOT, 'public', 'pyodide');
const OUT_ENGINE = join(ROOT, 'public', 'engine');
const OUT_SAMPLES = join(ROOT, 'public', 'samples');
const CACHE = join(ROOT, '.cache', 'pyodide');
const VENDOR = join(ROOT, 'vendor', 'pyodide');

const CORE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip'];

const SAMPLE_PAIRS = [
  {
    id: 'pair1_kr_appliance',
    title: '가정용 전기기기 안전 가상규정 (TXT, 한국어)',
    old: 'old_appliance_2023_v1.txt',
    new: 'new_appliance_2026_v2.txt',
    country: '대한민국(가상)',
    product: '가정용 전기기기',
  },
  {
    id: 'pair2_kr_lighting_hwpx',
    title: 'LED 조명기기 가상규정 (HWPX, 한국어)',
    old: 'old_lighting_2022_v1.hwpx',
    new: 'new_lighting_2026_v2.hwpx',
    country: '대한민국(가상)',
    product: 'LED 조명기기',
  },
  {
    id: 'pair3_en_battery',
    title: 'Battery safety synthetic regulation (PDF, 영어)',
    old: 'old_battery_2022_revA.pdf',
    new: 'new_battery_2026_revB.pdf',
    country: 'EU(가상)',
    product: '휴대용 배터리',
  },
  {
    id: 'pair4_en_machinery',
    title: 'Machinery safety synthetic regulation (DOCX, 영어)',
    old: 'old_machinery_2021_v1.docx',
    new: 'new_machinery_2026_v2.docx',
    country: '미국(가상)',
    product: '산업용 기계',
  },
];

function sha256(buf: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function fetchVerified(url: string, expectedSha: string, name: string): Promise<Buffer> {
  for (const dir of [VENDOR, CACHE]) {
    const p = join(dir, name);
    if (existsSync(p)) {
      const buf = readFileSync(p);
      if (sha256(buf) === expectedSha) return buf;
    }
  }
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const got = sha256(buf);
      if (got !== expectedSha) throw new Error(`sha256 불일치 (${got} ≠ ${expectedSha})`);
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(join(CACHE, name), buf);
      return buf;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`${name} 내려받기 실패: ${String(lastErr)} — 인터넷이 막힌 환경이면 vendor/pyodide/ 에 파일을 넣으세요.`);
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === '__pycache__') continue;
      out.push(...listFiles(p));
    } else out.push(p);
  }
  return out.sort();
}

async function main() {
  if (!existsSync(join(PYODIDE_PKG, 'package.json'))) throw new Error('node_modules/pyodide 가 없습니다. npm ci 를 먼저 실행하세요.');
  const pyVersion: string = JSON.parse(readFileSync(join(PYODIDE_PKG, 'package.json'), 'utf8')).version;
  const lock = JSON.parse(readFileSync(join(PYODIDE_PKG, 'pyodide-lock.json'), 'utf8'));

  rmSync(OUT_PY, { recursive: true, force: true });
  mkdirSync(join(OUT_PY, 'wheels'), { recursive: true });

  // 1) 코어
  for (const f of CORE_FILES) cpSync(join(PYODIDE_PKG, f), join(OUT_PY, f));

  // 2) 내장 패키지 — 필요한 것만 남긴 lock 파일을 함께 만든다
  const trimmed: Record<string, unknown> = {};
  const cdnBase = `https://cdn.jsdelivr.net/pyodide/v${pyVersion}/full/`;
  for (const name of BUILTIN_PACKAGES) {
    const pkg = lock.packages[name];
    if (!pkg) throw new Error(`pyodide-lock.json 에 ${name} 패키지가 없습니다 (Pyodide ${pyVersion}).`);
    for (const dep of pkg.depends ?? []) {
      if (!BUILTIN_PACKAGES.map(canon).includes(canon(dep))) throw new Error(`${name} 의 의존성 ${dep} 가 목록에 없습니다.`);
    }
    const buf = await fetchVerified(cdnBase + pkg.file_name, pkg.sha256, pkg.file_name);
    writeFileSync(join(OUT_PY, pkg.file_name), buf);
    trimmed[name] = pkg;
  }
  writeFileSync(join(OUT_PY, 'pyodide-lock.json'), JSON.stringify({ ...lock, packages: trimmed }));

  // 3) 순수 Python 휠
  for (const w of PURE_WHEELS) {
    const buf = await fetchVerified(w.url, w.sha256, w.file);
    writeFileSync(join(OUT_PY, 'wheels', w.file), buf);
  }

  // 4) 엔진 소스 묶음
  const engineDir = join(ROOT, 'engine', 'kats_diff');
  const files: Record<string, string> = {};
  for (const p of listFiles(engineDir)) {
    if (!/\.(py|json)$/.test(p)) continue;
    files[relative(join(ROOT, 'engine'), p).split('\\').join('/')] = readFileSync(p, 'utf8');
  }
  const engineHash = sha256(JSON.stringify(files)).slice(0, 16);
  rmSync(OUT_ENGINE, { recursive: true, force: true });
  mkdirSync(OUT_ENGINE, { recursive: true });
  writeFileSync(join(OUT_ENGINE, 'kats_diff.json'), JSON.stringify({ hash: engineHash, files }));

  // 5) 샘플(가상 규정) — 화면에서 '샘플로 해보기'와 원문 내려받기에 쓴다
  rmSync(OUT_SAMPLES, { recursive: true, force: true });
  for (const s of SAMPLE_PAIRS) {
    mkdirSync(join(OUT_SAMPLES, s.id), { recursive: true });
    for (const f of [s.old, s.new]) cpSync(join(ROOT, 'engine', 'samples', s.id, f), join(OUT_SAMPLES, s.id, f));
  }
  writeFileSync(join(OUT_SAMPLES, 'index.json'), JSON.stringify({ notice: '가상 규정 — 실제 준수 판단용 아님', pairs: SAMPLE_PAIRS }, null, 1));

  const manifest = {
    pyodideVersion: pyVersion,
    python: lock.info?.python,
    builtinPackages: BUILTIN_PACKAGES,
    wheels: PURE_WHEELS.map((w) => `wheels/${w.file}`),
    engine: { url: 'kats_diff.json', hash: engineHash },
  };
  writeFileSync(join(OUT_PY, 'manifest.json'), JSON.stringify(manifest, null, 1));

  const total = listFiles(OUT_PY).reduce((n, p) => n + statSync(p).size, 0);
  console.log(`[copy-pyodide] Pyodide ${pyVersion} (Python ${lock.info?.python}) · 패키지 ${BUILTIN_PACKAGES.length}+${PURE_WHEELS.length}개 · ${(total / 1048576).toFixed(1)}MB · 엔진 ${Object.keys(files).length}개 파일(${engineHash})`);
}

main().catch((err) => {
  console.error('[copy-pyodide] 실패:', err instanceof Error ? err.message : err);
  process.exit(1);
});
