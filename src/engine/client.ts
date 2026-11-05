/**
 * 변경체크 엔진 클라이언트 (메인 스레드). Worker 는 변경체크 화면에 처음 들어올 때만 만든다
 * (Pyodide 약 18MB 를 다른 화면에서는 내려받지 않는다).
 */
import type { EngineInfo, WorkerMessage, WorkerRequest } from './protocol';
import type { AnalysisView, AnalyzeMeta, EngineError, ExportFormat, LlmTarget, ReviewDecision } from './types';

type Progress = (pct: number, msg: string) => void;

export class EngineFailure extends Error {
  constructor(public detail: EngineError) {
    super(detail.message);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; progress?: Progress };

class EngineClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private initPromise: Promise<EngineInfo> | null = null;
  info: EngineInfo | null = null;
  private readyInfo: EngineInfo | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'kats-diff-engine' });
      this.worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
        const msg = ev.data;
        const p = this.pending.get(msg.id);
        if (msg.type === 'progress') p?.progress?.(msg.pct, msg.msg);
        else if (msg.type === 'ready') this.readyInfo = msg.info;
        else if (msg.type === 'result') {
          this.pending.delete(msg.id);
          p?.resolve(msg.data);
        }
      };
      this.worker.onerror = (ev) => {
        const err = new EngineFailure({ code: 'WORKER_ERROR', message: ev.message || '엔진 Worker 를 시작하지 못했습니다.', remediation: '최신 브라우저에서 다시 시도하세요.' });
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.initPromise = null;
        this.worker = null;
      };
    }
    return this.worker;
  }

  private call<T>(req: DistributiveOmit<WorkerRequest, 'id'>, progress?: Progress, transfer: Transferable[] = []): Promise<T> {
    const w = this.ensureWorker();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
      w.postMessage({ ...req, id } as WorkerRequest, transfer);
    });
  }

  get ready(): boolean {
    return this.info !== null;
  }

  init(progress?: Progress): Promise<EngineInfo> {
    if (!this.initPromise) {
      const baseUrl = new URL(import.meta.env.BASE_URL, location.href).href;
      this.initPromise = this.call<{ ok: boolean; error?: EngineError }>({ type: 'init', baseUrl }, progress).then((res) => {
        if (!res.ok) throw new EngineFailure(res.error ?? { code: 'INIT', message: '엔진을 준비하지 못했습니다.' });
        this.info = this.readyInfo ?? { pyodide: '?', python: '?', engine: '?', loadMs: 0 };
        return this.info;
      });
      this.initPromise.catch(() => {
        this.initPromise = null;
      });
    }
    return this.initPromise;
  }

  private unwrap<T>(data: unknown, key: string): T {
    const d = data as { ok: boolean; error?: EngineError } & Record<string, unknown>;
    if (!d.ok) throw new EngineFailure(d.error ?? { code: 'UNKNOWN', message: '알 수 없는 오류' });
    return d[key] as T;
  }

  async analyze(oldFile: { name: string; bytes: ArrayBuffer }, newFile: { name: string; bytes: ArrayBuffer }, meta: AnalyzeMeta, progress?: Progress): Promise<AnalysisView> {
    await this.init(progress);
    const data = await this.call({ type: 'analyze', old: oldFile, new: newFile, meta }, progress, [oldFile.bytes, newFile.bytes]);
    return this.unwrap<AnalysisView>(data, 'view');
  }

  async targets(): Promise<LlmTarget[]> {
    return this.unwrap<LlmTarget[]>(await this.call({ type: 'targets' }), 'targets');
  }

  async applyLlm(outputs: Record<string, unknown>, meta: Record<string, unknown>): Promise<{ view: AnalysisView; result: { accepted: string[]; rejected: Record<string, string> } }> {
    const data = (await this.call({ type: 'applyLlm', outputs, meta })) as { ok: boolean; error?: EngineError; view: AnalysisView; result: { accepted: string[]; rejected: Record<string, string> } };
    if (!data.ok) throw new EngineFailure(data.error!);
    return { view: data.view, result: data.result };
  }

  async review(kind: 'change' | 'checklist' | 'alignment', resultId: string, decision: ReviewDecision, note = ''): Promise<AnalysisView> {
    return this.unwrap<AnalysisView>(await this.call({ type: 'review', kind, resultId, decision, note }), 'view');
  }

  async exportFile(format: ExportFormat): Promise<{ bytes: ArrayBuffer; mime: string; filename: string }> {
    return this.unwrap(await this.call({ type: 'export', format }), 'file');
  }
}

export const engine = new EngineClient();

/** 브라우저 안에서 만든 파일을 사용자 PC 로 내려받는다 (서버 없음) */
export function downloadBytes(bytes: ArrayBuffer | Uint8Array | string, mime: string, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
