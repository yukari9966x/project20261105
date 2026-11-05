import type { AnalyzeMeta, ExportFormat, ReviewDecision } from './types';

export type WorkerRequest =
  | { type: 'init'; id: number; baseUrl: string }
  | { type: 'analyze'; id: number; old: { name: string; bytes: ArrayBuffer }; new: { name: string; bytes: ArrayBuffer }; meta?: AnalyzeMeta }
  | { type: 'targets'; id: number }
  | { type: 'applyLlm'; id: number; outputs: Record<string, unknown>; meta?: Record<string, unknown> }
  | { type: 'review'; id: number; kind: 'change' | 'checklist' | 'alignment'; resultId: string; decision: ReviewDecision; note?: string }
  | { type: 'export'; id: number; format: ExportFormat };

export interface EngineInfo {
  pyodide: string;
  python: string;
  engine: string;
  loadMs: number;
}

export type WorkerMessage =
  | { type: 'progress'; id: number; pct: number; msg: string }
  | { type: 'ready'; id: number; info: EngineInfo }
  | { type: 'result'; id: number; data: unknown };
