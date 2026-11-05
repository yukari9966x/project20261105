/** 변경체크 엔진(kats_diff.pipeline.to_view) 결과 형태 */

export interface EngineError {
  code: string;
  message: string;
  remediation?: string;
  trace?: string;
}

export interface DocView {
  id: string;
  sha256: string;
  filename: string;
  media_type: string;
  title: string;
  language: string;
  page_count: number;
  extraction_status: string;
  version_label: string;
  source_kind: string;
}

export interface ClauseView {
  id: string;
  clause_number: string | null;
  heading_path: string;
  text: string;
  locator: string;
  sequence_no: number;
  segment_ids: string[];
  version_side: 'old' | 'new';
}

export interface AlignmentView {
  id: string;
  old_clause_ids: string[];
  new_clause_ids: string[];
  method: string;
  relationship: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many' | 'unmatched_old' | 'unmatched_new';
  flags: string[];
  confidence_band: 'high' | 'medium' | 'low';
  similarity_score: number;
  explanation: string;
  evidence_ids: string[];
  review_status: ReviewDecision;
  revision: number;
}

export interface NumericFactView {
  raw_value: string;
  decimal_value: string | null;
  raw_unit: string;
  canonical_unit: string | null;
  canonical_decimal: string | null;
  operator: string;
  operator_raw: string;
  quantity_kind: string;
  subject: string;
  conditions: string;
  modality: string;
}

export interface NumericDeltaView {
  subject: string;
  quantity_kind: string;
  old_fact: NumericFactView | null;
  new_fact: NumericFactView | null;
  status: string;
  summary_ko: string;
  calculable: boolean;
  reason_ko: string;
}

export interface DateDeltaView {
  role: string;
  old_date_raw: string | null;
  new_date_raw: string | null;
  resolved_date: string | null;
  status: 'confirmed' | 'unconfirmed' | string;
  basis_note_ko: string;
  calculable: boolean;
}

export type ReviewDecision = 'unreviewed' | 'confirmed' | 'modified' | 'rejected';

export interface ChangeView {
  id: string;
  alignment_id: string;
  categories: string[];
  semantic_status: 'unchanged' | 'format_only' | 'changed' | 'addition_candidate' | 'deletion_candidate' | 'unresolved';
  summary_ko: string;
  old_fact: string;
  new_fact: string;
  changed_obligations: string[];
  numeric_deltas: NumericDeltaView[];
  date_deltas: DateDeltaView[];
  scope_conditions: string;
  uncertainties: string[];
  evidence_old_ids: string[];
  evidence_new_ids: string[];
  verification_status: 'valid' | 'invalid' | 'missing';
  review_status: ReviewDecision;
  reviewer_note: string;
  revision: number;
}

export interface ChecklistItemView {
  id: string;
  change_id: string;
  action_ko: string;
  applicable_condition: string;
  due_date: string | null;
  due_date_status: string;
  priority_reason: string;
  verification_question: string;
  suggested_evidence_to_prepare: string;
  owner_placeholder: string;
  review_status: ReviewDecision;
  reviewer_note: string;
}

export interface EvidenceView {
  id: string;
  document_id: string;
  segment_id: string;
  raw_start: number;
  raw_end: number;
  quote: string;
  verification_status: 'valid' | 'invalid' | 'missing';
  reason: string;
  locator: string | null;
}

export interface CoverageView {
  total_old_clauses: number;
  total_new_clauses: number;
  accounted_old: number;
  accounted_new: number;
  unresolved_old: number;
  unresolved_new: number;
  duplicate_old: number;
  duplicate_new: number;
  is_complete: boolean;
}

export interface RunView {
  id: string;
  provider: string;
  model_name: string;
  mode: 'demo' | 'live' | string;
  status: 'running' | 'succeeded' | 'partial' | 'failed' | string;
  errors: string[];
  started_at: string;
  finished_at: string | null;
  usage_if_available: Record<string, unknown> | null;
}

export interface AnalysisView {
  engine_version: string;
  project: { id: string; title: string; country: string; product_scope: string; old_version: string; new_version: string; target_date: string; status: string };
  documents: { old: DocView; new: DocView };
  clauses: { old: ClauseView[]; new: ClauseView[] };
  alignments: AlignmentView[];
  changes: ChangeView[];
  checklist_items: ChecklistItemView[];
  coverage: CoverageView;
  run: RunView;
  evidences: Record<string, EvidenceView>;
  segments: Record<string, { id: string; locator: string; raw_text: string; heading_path: string }>;
  notices: { synthetic: string; mode: string; completeness: string; export_version: string };
  is_synthetic: boolean;
  fixture_replay: boolean;
  llm: { provider?: string; model?: string; accepted?: number; rejected?: Record<string, string> };
  reviews: unknown[];
  timings_ms: Record<string, number>;
}

export interface LlmTarget {
  lookup_key: string;
  alignment_id: string;
  relationship: string;
  old_clauses: { number: string | null; text: string }[];
  new_clauses: { number: string | null; text: string }[];
}

export interface AnalyzeMeta {
  title?: string;
  country?: string;
  product?: string;
  oldVersion?: string;
  newVersion?: string;
  targetDate?: string;
  isSynthetic?: boolean;
  useRecordedAi?: boolean;
}

export type ExportFormat = 'xlsx' | 'docx' | 'md' | 'json' | 'html';
