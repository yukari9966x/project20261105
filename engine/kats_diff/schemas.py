"""스키마 및 도메인 모델 정의 (공통 모델 [C] 및 앱 전용 모델 [H2-2])."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class CompatModel(BaseModel):
    """공통 직렬화/역직렬화 헬퍼 모델 (Pydantic v2)."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    def to_dict(self) -> Dict[str, Any]:
        return self.model_dump()

    @classmethod
    def from_obj(cls, data: Any):
        return cls.model_validate(data)

    @classmethod
    def json_schema_dict(cls) -> Dict[str, Any]:
        return cls.model_json_schema()


# ---------------------------------------------------------------------------
# 공통 에러 계약 ([F])
# ---------------------------------------------------------------------------
ErrorCode = Literal[
    "NEEDS_OCR",
    "UNSUPPORTED_FORMAT",
    "FILE_TOO_LARGE",
    "PROVIDER_NOT_CONFIGURED",
    "MODEL_NOT_FOUND",
    "POLICY_BLOCKED",
    "INVALID_MODEL_OUTPUT",
    "EVIDENCE_INVALID",
    "INPUT_TOO_LARGE",
    "STALE_RESULT",
    "NOT_FOUND",
    "VALIDATION_ERROR",
    "INTERNAL_ERROR",
    "CSRF_OR_ORIGIN_BLOCKED",
]


class ErrorPayload(CompatModel):
    code: str
    message_ko: str
    retryable: bool = False
    job_id: Optional[str] = None
    remediation: str = ""


class AppException(Exception):
    def __init__(
        self,
        code: str,
        message_ko: str,
        status_code: int = 400,
        retryable: bool = False,
        job_id: Optional[str] = None,
        remediation: str = "",
    ) -> None:
        super().__init__(message_ko)
        self.code = code
        self.message_ko = message_ko
        self.status_code = status_code
        self.retryable = retryable
        self.job_id = job_id
        self.remediation = remediation

    def to_payload(self) -> Dict[str, Any]:
        return ErrorPayload(
            code=self.code,
            message_ko=self.message_ko,
            retryable=self.retryable,
            job_id=self.job_id,
            remediation=self.remediation,
        ).to_dict()


# ---------------------------------------------------------------------------
# 공통 데이터 모델 ([C])
# ---------------------------------------------------------------------------
SourceKind = Literal["official", "user", "synthetic"]
DataClass = Literal["public", "internal", "restricted"]
ExtractionStatus = Literal["succeeded", "succeeded_ocr", "needs_ocr", "failed"]


class Document(CompatModel):
    id: str
    sha256: str
    filename: str
    media_type: str
    title: str
    language: str = "ko"
    source_url: Optional[str] = None
    source_kind: SourceKind = "user"
    data_class: DataClass = "internal"
    permission_confirmed: bool = False
    version_label: str = ""
    imported_at: str = Field(default_factory=utc_now_iso)
    extraction_status: ExtractionStatus = "succeeded"
    parser_version: str = "1.0.0"
    page_count: int = 1
    is_deleted: bool = False


class TableLocation(CompatModel):
    table_index: int
    row_index: int
    col_index: int
    table_title: Optional[str] = None
    row_header: Optional[str] = None
    col_header: Optional[str] = None


class Segment(CompatModel):
    id: str
    document_id: str
    document_sha256: str
    locator: str  # PDF: page:1, TXT: lines:1-5, DOCX: para:1 or table:1:r1c1, HWPX: sec:0/para:1
    heading_path: str = ""
    raw_text: str
    normalized_text: str
    normalization_map: Optional[List[int]] = None
    order_index: int
    table_location: Optional[TableLocation] = None


EvidenceStatus = Literal["valid", "invalid", "missing"]


class Evidence(CompatModel):
    id: str
    document_id: str
    segment_id: str
    raw_start: int
    raw_end: int
    quote: str
    verification_status: EvidenceStatus = "valid"
    reason: str = ""
    locator: Optional[str] = None


class AnalysisRun(CompatModel):
    id: str
    project_id: Optional[str] = None
    input_hashes: List[str] = Field(default_factory=list)
    config_hash: str = ""
    provider: str = "fixture"
    model_name: str = "fixture-v1"
    model_revision_if_known: Optional[str] = None
    prompt_version: str = "v1.0"
    schema_version: str = "v1"
    code_version_if_known: Optional[str] = "0.1.0"
    mode: str = "demo"
    started_at: str = Field(default_factory=utc_now_iso)
    finished_at: Optional[str] = None
    status: str = "running"  # running | succeeded | partial | failed
    errors: List[str] = Field(default_factory=list)
    usage_if_available: Optional[Dict[str, Any]] = None


ReviewDecision = Literal["unreviewed", "confirmed", "modified", "rejected"]


class Review(CompatModel):
    id: str
    result_id: str
    result_kind: str = "change"  # alignment | change | checklist
    result_revision: int = 1
    decision: ReviewDecision = "unreviewed"
    reviewer_label: str = ""
    note: str = ""
    manual_evidence_quote: Optional[str] = None
    reviewed_at: str = Field(default_factory=utc_now_iso)


JobState = Literal["queued", "running", "succeeded", "failed", "interrupted", "cancelled"]


class Job(CompatModel):
    id: str
    kind: str  # analyze_comparison | reanalyze_alignment
    state: JobState = "queued"
    progress: int = 0
    heartbeat_at: str = Field(default_factory=utc_now_iso)
    retry_count: int = 0
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    input_snapshot: Dict[str, Any] = Field(default_factory=dict)
    output_id: Optional[str] = None
    idempotency_key: Optional[str] = None


# ---------------------------------------------------------------------------
# 앱 2 전용 데이터 모델 ([H2-2])
# ---------------------------------------------------------------------------
class ComparisonProject(CompatModel):
    id: str
    title: str
    country: str
    product_scope: str
    old_document_ids: List[str]
    new_document_ids: List[str]
    old_version: str
    new_version: str
    target_date: str = "2026-10-29"
    scope_note: str = ""
    status: str = "draft"  # draft | analyzing | ready | partial | stale | failed
    latest_run_id: Optional[str] = None
    created_at: str = Field(default_factory=utc_now_iso)


class Clause(CompatModel):
    id: str
    document_id: str
    version_side: Literal["old", "new"]
    heading_path: str = ""
    clause_number: Optional[str] = None
    segment_ids: List[str] = Field(default_factory=list)
    text: str
    normalized_text: str = ""
    table_cells: List[Dict[str, Any]] = Field(default_factory=list)
    footnotes: List[str] = Field(default_factory=list)
    sequence_no: int
    content_hash: str
    locator: str = ""


AlignmentMethod = Literal["exact", "anchor", "similarity", "llm", "manual"]
AlignmentRelationship = Literal[
    "one_to_one",
    "one_to_many",
    "many_to_one",
    "many_to_many",
    "unmatched_old",
    "unmatched_new",
]
ConfidenceBand = Literal["high", "medium", "low"]


class Alignment(CompatModel):
    id: str
    project_id: str
    old_clause_ids: List[str] = Field(default_factory=list)
    new_clause_ids: List[str] = Field(default_factory=list)
    method: AlignmentMethod = "exact"
    relationship: AlignmentRelationship = "one_to_one"
    flags: List[str] = Field(default_factory=list)  # e.g., ["moved", "split", "merged", "repeated_number"]
    confidence_band: ConfidenceBand = "high"
    similarity_score: float = 1.0
    explanation: str = ""
    evidence_ids: List[str] = Field(default_factory=list)
    review_status: ReviewDecision = "unreviewed"
    revision: int = 1


NumericOperator = Literal["lt", "le", "eq", "ge", "gt", "range", "unknown"]


class NumericFact(CompatModel):
    raw_value: str
    decimal_value: Optional[str] = None  # Decimal serialized as exact string
    raw_unit: str = ""
    canonical_unit: Optional[str] = None
    canonical_decimal: Optional[str] = None
    operator: NumericOperator = "eq"
    operator_raw: str = ""
    quantity_kind: str = "unknown"  # length | current | voltage | time | power | temperature | ratio | unsupported
    subject: str = ""
    test_method: str = ""
    conditions: str = ""
    modality: str = "mandatory"  # mandatory(shall) | prohibition(shall_not) | optional(may)
    evidence_ids: List[str] = Field(default_factory=list)
    parse_status: str = "parsed"  # parsed | review_required


class NumericDelta(CompatModel):
    subject: str
    quantity_kind: str
    old_fact: Optional[NumericFact] = None
    new_fact: Optional[NumericFact] = None
    status: str  # numeric_equivalent | tightened | relaxed | boundary_changed | condition_changed_review | unit_unsupported_review | value_changed_review
    summary_ko: str
    calculable: bool = True
    reason_ko: str = ""


class DateDelta(CompatModel):
    role: str  # effective_date | grace_period_end | manufacturing_date_basis | import_date_basis | promulgation_date | relative_period
    old_date_raw: Optional[str] = None
    new_date_raw: Optional[str] = None
    resolved_date: Optional[str] = None
    status: str = "confirmed"  # confirmed | unconfirmed
    basis_note_ko: str = ""
    calculable: bool = True


SemanticStatus = Literal[
    "unchanged",
    "format_only",
    "changed",
    "addition_candidate",
    "deletion_candidate",
    "unresolved",
]


class Change(CompatModel):
    id: str
    project_id: str
    alignment_id: str
    categories: List[str] = Field(default_factory=list)
    semantic_status: SemanticStatus = "unchanged"
    summary_ko: str = ""
    old_fact: str = ""
    new_fact: str = ""
    changed_obligations: List[str] = Field(default_factory=list)
    numeric_deltas: List[NumericDelta] = Field(default_factory=list)
    date_deltas: List[DateDelta] = Field(default_factory=list)
    scope_conditions: str = ""
    uncertainties: List[str] = Field(default_factory=list)
    evidence_old_ids: List[str] = Field(default_factory=list)
    evidence_new_ids: List[str] = Field(default_factory=list)
    verification_status: EvidenceStatus = "valid"
    review_status: ReviewDecision = "unreviewed"
    reviewer_note: str = ""
    is_stale: bool = False
    revision: int = 1


class ChecklistItem(CompatModel):
    id: str
    project_id: str
    change_id: str
    action_ko: str
    applicable_condition: str = ""
    due_date: Optional[str] = None
    due_date_status: str = "unconfirmed"  # confirmed | unconfirmed | not_applicable
    priority_reason: str = ""
    verification_question: str = ""
    suggested_evidence_to_prepare: str = ""
    owner_placeholder: str = "담당자 미지정 (확인 필요)"
    review_status: ReviewDecision = "unreviewed"
    reviewer_note: str = ""
    is_stale: bool = False
    revision: int = 1


class Coverage(CompatModel):
    project_id: str
    total_old_clauses: int = 0
    total_new_clauses: int = 0
    accounted_old: int = 0
    accounted_new: int = 0
    unresolved_old: int = 0
    unresolved_new: int = 0
    duplicate_old: int = 0
    duplicate_new: int = 0
    analyzed_alignments: int = 0
    failed_alignments: int = 0
    is_complete: bool = False
    scope_hash: str = ""
