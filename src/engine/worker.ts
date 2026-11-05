/**
 * 변경체크 엔진 Web Worker — Pyodide(브라우저 Python)로 kats_diff 엔진을 돌린다.
 * 화면이 멈추지 않도록 별도 스레드에서 실행하고, 진행률을 메시지로 보낸다.
 * Pyodide 파일은 사이트에 함께 들어 있어(자체 호스팅) 외부 CDN 없이 내부망에서도 동작한다.
 * 문서 바이트는 이 Worker 메모리에만 있고 어디에도 전송하지 않는다.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WorkerRequest, WorkerMessage } from './protocol';

const ctx = self as unknown as {
  postMessage(msg: WorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
};

let pyodide: any = null;
let bridge: any = null;
let initPromise: Promise<void> | null = null;

const post = (msg: WorkerMessage, transfer?: Transferable[]) => ctx.postMessage(msg, transfer);

async function init(baseUrl: string, id: number): Promise<void> {
  const progress = (pct: number, msg: string) => post({ type: 'progress', id, pct, msg });
  const t0 = performance.now();
  const indexURL = new URL('pyodide/', baseUrl).href;
  progress(3, 'Python 실행기(Pyodide) 내려받는 중');
  const { loadPyodide } = await import(/* @vite-ignore */ indexURL + 'pyodide.mjs');
  pyodide = await loadPyodide({ indexURL });
  const manifest = await (await fetch(indexURL + 'manifest.json')).json();
  progress(35, '엔진 패키지 불러오는 중 (lxml·pydantic)');
  await pyodide.loadPackage(manifest.builtinPackages, { messageCallback: () => {}, errorCallback: () => {} });
  progress(60, '문서 해석 패키지 설치 중 (pypdf·python-docx·openpyxl·defusedxml)');
  const micropip = pyodide.pyimport('micropip');
  await micropip.install.callKwargs(manifest.wheels.map((w: string) => indexURL + w), { deps: false });
  progress(80, '변경체크 엔진 준비 중');
  const engineRes = await fetch(new URL('engine/' + manifest.engine.url, baseUrl).href + '?v=' + manifest.engine.hash);
  const engine: { files: Record<string, string> } = await engineRes.json();
  for (const [rel, text] of Object.entries(engine.files)) {
    const full = '/home/pyodide/engine/' + rel;
    pyodide.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
    pyodide.FS.writeFile(full, text);
  }
  pyodide.runPython("import sys\nif '/home/pyodide/engine' not in sys.path: sys.path.insert(0, '/home/pyodide/engine')");
  bridge = pyodide.pyimport('kats_diff.bridge');
  const version = String(bridge.version());
  post({
    type: 'ready',
    id,
    info: {
      pyodide: manifest.pyodideVersion,
      python: String(pyodide.runPython('import sys; sys.version.split()[0]')),
      engine: version,
      loadMs: Math.round(performance.now() - t0),
    },
  });
}

function parse(json: string): any {
  return JSON.parse(json);
}

async function handle(req: WorkerRequest): Promise<void> {
  const { id } = req;
  try {
    if (req.type === 'init') {
      if (!initPromise) initPromise = init(req.baseUrl, id);
      else post({ type: 'progress', id, pct: 100, msg: '준비 완료' });
      await initPromise;
      post({ type: 'result', id, data: { ok: true } });
      return;
    }
    if (!bridge) throw new Error('엔진이 아직 준비되지 않았습니다.');
    switch (req.type) {
      case 'analyze': {
        const oldPy = pyodide.toPy(new Uint8Array(req.old.bytes));
        const newPy = pyodide.toPy(new Uint8Array(req.new.bytes));
        const cb = (pct: number, msg: string) => post({ type: 'progress', id, pct, msg });
        try {
          const out = bridge.run_analyze(req.old.name, oldPy, req.new.name, newPy, JSON.stringify(req.meta ?? {}), cb);
          post({ type: 'result', id, data: parse(out) });
        } finally {
          oldPy.destroy?.();
          newPy.destroy?.();
        }
        return;
      }
      case 'targets':
        post({ type: 'result', id, data: parse(bridge.run_targets()) });
        return;
      case 'applyLlm':
        post({ type: 'result', id, data: parse(bridge.run_apply_llm(JSON.stringify(req.outputs), JSON.stringify(req.meta ?? {}))) });
        return;
      case 'review':
        post({ type: 'result', id, data: parse(bridge.run_review(req.kind, req.resultId, req.decision, req.note ?? '')) });
        return;
      case 'export': {
        const res = bridge.run_export(req.format);
        const [ok, payload, mime, filename] = res.toJs({ create_proxies: false }) as [boolean, any, string, string];
        res.destroy?.();
        if (!ok) {
          post({ type: 'result', id, data: parse(String(payload)) });
          return;
        }
        const bytes: Uint8Array = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        post({ type: 'result', id, data: { ok: true, file: { bytes: buf, mime, filename } } }, [buf]);
        return;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[kats-diff worker]', req.type, message);
    if (req.type === 'init') initPromise = null; // 다음 시도에서 처음부터 다시 준비
    post({ type: 'result', id, data: { ok: false, error: { code: 'WORKER_ERROR', message, remediation: '페이지를 새로 고친 뒤 다시 시도하세요. 오래된 브라우저라면 최신 Chrome·Edge·Firefox·Safari 를 쓰세요.' } } });
  }
}

let queue: Promise<void> = Promise.resolve();
ctx.onmessage = (ev) => {
  // Python 은 한 번에 하나씩 — 요청을 차례로 처리한다
  queue = queue.then(() => handle(ev.data));
};
