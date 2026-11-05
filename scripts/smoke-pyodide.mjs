/**
 * smoke-pyodide.mjs — 브라우저와 같은 Pyodide 파일(public/pyodide)로 변경체크 엔진이 설치·실행되는지 확인한다.
 * (아키텍처 '제약과 대응': 가장 먼저 확인할 것 = Pyodide 에서 기존 엔진이 설치·실행되는지)
 *
 *   npm run prepare-data && node scripts/smoke-pyodide.mjs
 *
 * public/ 을 로컬 HTTP 로 띄우고 micropip 가 그 주소에서 휠을 설치하게 해, 브라우저 Web Worker 와 같은 경로를 탄다.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const TYPES = { '.whl': 'application/zip', '.json': 'application/json', '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.zip': 'application/zip' };

const server = createServer((req, res) => {
  const p = join(PUBLIC, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(PUBLIC) || !existsSync(p) || statSync(p).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }).end(readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const t0 = performance.now();
const { loadPyodide } = await import(pathToFileURL(join(PUBLIC, 'pyodide', 'pyodide.mjs')).href);
const manifest = JSON.parse(readFileSync(join(PUBLIC, 'pyodide', 'manifest.json'), 'utf8'));
const pyodide = await loadPyodide({ indexURL: join(PUBLIC, 'pyodide') + '/' });
await pyodide.loadPackage(manifest.builtinPackages, { messageCallback: () => {} });
const micropip = pyodide.pyimport('micropip');
await micropip.install(manifest.wheels.map((w) => base + 'pyodide/' + w), { deps: false });
const engine = JSON.parse(readFileSync(join(PUBLIC, 'engine', 'kats_diff.json'), 'utf8'));
for (const [rel, text] of Object.entries(engine.files)) {
  const full = '/home/pyodide/engine/' + rel;
  pyodide.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
  pyodide.FS.writeFile(full, text);
}
pyodide.runPython("import sys; sys.path.insert(0, '/home/pyodide/engine')");
const tLoad = performance.now() - t0;

const samples = JSON.parse(readFileSync(join(PUBLIC, 'samples', 'index.json'), 'utf8')).pairs;
let failures = 0;
for (const s of samples) {
  const oldBytes = readFileSync(join(PUBLIC, 'samples', s.id, s.old));
  const newBytes = readFileSync(join(PUBLIC, 'samples', s.id, s.new));
  pyodide.globals.set('old_b', pyodide.toPy(new Uint8Array(oldBytes)));
  pyodide.globals.set('new_b', pyodide.toPy(new Uint8Array(newBytes)));
  pyodide.globals.set('names', pyodide.toPy([s.old, s.new]));
  const t1 = performance.now();
  const out = pyodide.runPython(`
import json, io
from kats_diff.pipeline import analyze, export, to_view
st = analyze(names[0], bytes(old_b), names[1], bytes(new_b), is_synthetic=True)
view = to_view(st)
x, _, _ = export(st, "xlsx")
d, _, _ = export(st, "docx")
import openpyxl, docx
wb = openpyxl.load_workbook(io.BytesIO(x))
json.dumps({"old": len(st.old_clauses), "new": len(st.new_clauses), "changes": sum(1 for c in st.changes if c.semantic_status not in ("unchanged","format_only")),
            "complete": st.coverage.is_complete, "status": st.run.status, "sheets": len(wb.sheetnames),
            "docx_tables": len(docx.Document(io.BytesIO(d)).tables), "view_bytes": len(json.dumps(view, ensure_ascii=False))})
`);
  const r = JSON.parse(out);
  const ok = r.complete && r.sheets === 7 && r.docx_tables > 0 && r.changes > 0;
  failures += ok ? 0 : 1;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${s.id}: 조항 ${r.old}→${r.new}, 변경 ${r.changes}건, 커버리지 ${r.complete ? '완전' : '불완전'}, XLSX ${r.sheets}시트, DOCX 표 ${r.docx_tables}개 (${Math.round(performance.now() - t1)}ms)`);
}
console.log(`Pyodide ${manifest.pyodideVersion} / Python ${pyodide.runPython('import sys; sys.version.split()[0]')} — 로딩·설치 ${Math.round(tLoad)}ms`);

// --unittest: engine/tests 전체(단위·회귀·파이프라인)를 Pyodide 안에서 실행 — Python 3.14 호환성 확인
if (process.argv.includes('--unittest')) {
  const { readdirSync } = await import('node:fs');
  const mount = (srcDir, dstDir) => {
    for (const name of readdirSync(srcDir)) {
      if (name === '__pycache__') continue;
      const s = join(srcDir, name);
      const d = dstDir + '/' + name;
      if (statSync(s).isDirectory()) {
        pyodide.FS.mkdirTree(d);
        mount(s, d);
      } else pyodide.FS.writeFile(d, readFileSync(s));
    }
  };
  pyodide.FS.mkdirTree('/home/pyodide/engine/tests');
  pyodide.FS.mkdirTree('/home/pyodide/engine/samples');
  mount(join(ROOT, 'engine', 'tests'), '/home/pyodide/engine/tests');
  mount(join(ROOT, 'engine', 'samples'), '/home/pyodide/engine/samples');
  const summary = pyodide.runPython(`
import io, unittest, os
os.chdir('/home/pyodide/engine')
buf = io.StringIO()
suite = unittest.defaultTestLoader.discover('tests', top_level_dir='.')
res = unittest.TextTestRunner(stream=buf, verbosity=1).run(suite)
print(buf.getvalue()[-1500:])
f"tests={res.testsRun} failures={len(res.failures)} errors={len(res.errors)} skipped={len(res.skipped)}"
`);
  console.log('[Pyodide unittest]', summary);
  if (!/failures=0 errors=0/.test(summary)) failures += 1;
}
server.close();
process.exit(failures ? 1 : 0);
