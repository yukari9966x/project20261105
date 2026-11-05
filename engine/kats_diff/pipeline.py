"""브라우저(Pyodide)용 분석 파이프라인.

원본 kats-regulation-diff 의 `services/jobs/runner.py`(SQLite·작업큐·LLM 어댑터)를 걷어내고
같은 도메인 함수를 같은 순서로 메모리에서 실행한다.

    DocumentParser → ClauseSegmenter → DeterministicAligner/CandidateBuilder
    → AlignmentValidator → ChangeExtractor/NumericDateChecker → EvidenceVerifier → ChecklistBuilder

LLM 호출은 여기서 하지 않는다. 브라우저(TypeScript)가 사용자 키로 바뀐 조항만 LLM 에 보내고,
돌아온 JSON 을 `apply_llm_outputs()` 에 넘기면 원본 엔진과 같은 방식(변경 추출기 병합 + 원문 근거 재검증)으로 반영한다.
"""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .aligner import align_clauses_pipeline
from .change_extractor import build_checklist_items, extract_changes_for_alignments
from .exporter import export_project_artifact
from .parser import ingest_document_bytes
from .schemas import (
    Alignment,
    AnalysisRun,
    AppException,
    Change,
    ChecklistItem,
    Clause,
    ComparisonProject,
    Coverage,
    Document,
    Evidence,
    Review,
    Segment,
    utc_now_iso,
)
from .segmenter import segment_clauses

ENGINE_VERSION = "0.2.0-pyodide.1"
PROMPT_VERSION = "v1.0"
SCHEMA_VERSION = "v1"
MAX_ALIGNMENT_GROUP = 3
MAX_LLM_CALLS_PER_RUN = 100

_PKG_DIR = Path(__file__).resolve().parent
FIXTURE_REGISTRY_PATH = _PKG_DIR / "samples" / "fixture_registry.json"

ProgressFn = Optional[Callable[[int, str], Any]]

VALID_SEMANTIC = {"unchanged", "format_only", "changed", "addition_candidate", "deletion_candidate", "unresolved"}


@dataclass
class AnalysisState:
    """한 번의 구판·신판 대조 결과 전체 (브라우저 메모리에만 존재)."""

    project: ComparisonProject
    old_doc: Document
    new_doc: Document
    old_segments: List[Segment]
    new_segments: List[Segment]
    old_clauses: List[Clause]
    new_clauses: List[Clause]
    alignments: List[Alignment]
    changes: List[Change]
    checklist_items: List[ChecklistItem]
    coverage: Coverage
    run: AnalysisRun
    evidences: Dict[str, Evidence]
    alignment_evidence_ids: List[str]
    is_synthetic: bool = False
    fixture_replay: bool = False
    llm_outputs: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    llm_meta: Dict[str, Any] = field(default_factory=dict)
    reviews: List[Review] = field(default_factory=list)
    timings_ms: Dict[str, int] = field(default_factory=dict)


def _progress(fn: ProgressFn, pct: int, msg: str) -> None:
    if fn is not None:
        try:
            fn(int(pct), str(msg))
        except Exception:  # 진행률 표시는 실패해도 분석을 멈추지 않는다
            pass


def load_fixture_for_hashes(old_sha256: str, new_sha256: str) -> Optional[Dict[str, Any]]:
    """내장 샘플 4쌍의 정확한 SHA-256 쌍에만 대응하는 '기록된 AI 응답'을 돌려준다 (원본 엔진 데모 모드와 동일 규칙)."""
    if not FIXTURE_REGISTRY_PATH.exists():
        return None
    try:
        registry = json.loads(FIXTURE_REGISTRY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    return registry.get("pairs", {}).get(f"{old_sha256}:{new_sha256}")


def _lookup_key(aln: Alignment, old_by_id: Dict[str, Clause], new_by_id: Dict[str, Clause]) -> Tuple[str, str, str]:
    ocl = [old_by_id[c] for c in aln.old_clause_ids if c in old_by_id]
    ncl = [new_by_id[c] for c in aln.new_clause_ids if c in new_by_id]
    old_nums = ", ".join(c.clause_number or c.id for c in ocl)
    new_nums = ", ".join(c.clause_number or c.id for c in ncl)
    return f"{old_nums}->{new_nums}", old_nums, new_nums


def _extract(state_like: Dict[str, Any], alignments: List[Alignment], fixture_changes: Optional[Dict[str, Dict[str, Any]]]):
    return extract_changes_for_alignments(
        project_id=state_like["project"].id,
        old_doc=state_like["old_doc"],
        new_doc=state_like["new_doc"],
        old_clauses=state_like["old_clauses"],
        new_clauses=state_like["new_clauses"],
        old_segments=state_like["old_segments"],
        new_segments=state_like["new_segments"],
        alignments=alignments,
        fixture_changes=fixture_changes,
    )


def analyze(
    old_name: str,
    old_bytes: bytes,
    new_name: str,
    new_bytes: bytes,
    *,
    title: str = "",
    country: str = "",
    product_scope: str = "",
    old_version: str = "",
    new_version: str = "",
    target_date: str = "",
    is_synthetic: bool = False,
    use_recorded_ai: bool = False,
    progress: ProgressFn = None,
) -> AnalysisState:
    """구판·신판 바이트를 받아 원본 엔진과 같은 순서로 분석한다. 파일은 메모리에서만 다룬다."""
    t0 = time.perf_counter()
    timings: Dict[str, int] = {}

    _progress(progress, 5, "문서 읽는 중")
    old_doc, old_segments = ingest_document_bytes(
        old_name, bytes(old_bytes), version_label=old_version, doc_id=f"doc-old-{uuid.uuid4().hex[:8]}",
        source_kind="synthetic" if is_synthetic else "user", data_class="public" if is_synthetic else "internal",
    )
    new_doc, new_segments = ingest_document_bytes(
        new_name, bytes(new_bytes), version_label=new_version, doc_id=f"doc-new-{uuid.uuid4().hex[:8]}",
        source_kind="synthetic" if is_synthetic else "user", data_class="public" if is_synthetic else "internal",
    )
    timings["parse"] = int((time.perf_counter() - t0) * 1000)

    project = ComparisonProject(
        id=f"cmp-{uuid.uuid4().hex[:8]}",
        title=title.strip() or f"{old_doc.title} ↔ {new_doc.title}",
        country=country.strip() or "미지정",
        product_scope=product_scope.strip() or "미지정",
        old_document_ids=[old_doc.id],
        new_document_ids=[new_doc.id],
        old_version=old_version.strip() or old_doc.filename,
        new_version=new_version.strip() or new_doc.filename,
        target_date=target_date.strip() or utc_now_iso()[:10],
        status="analyzing",
    )

    fixture_bundle = load_fixture_for_hashes(old_doc.sha256, new_doc.sha256) if use_recorded_ai else None
    run = AnalysisRun(
        id=f"run-{uuid.uuid4().hex[:10]}",
        project_id=project.id,
        input_hashes=[old_doc.sha256, new_doc.sha256],
        config_hash=hashlib.sha256(f"pyodide:{ENGINE_VERSION}:{bool(fixture_bundle)}".encode()).hexdigest()[:12],
        provider="fixture" if fixture_bundle else "rule-engine",
        model_name="fixture-exact-sha256" if fixture_bundle else "rule-only",
        prompt_version=PROMPT_VERSION,
        schema_version=SCHEMA_VERSION,
        code_version_if_known=ENGINE_VERSION,
        mode="demo",
        status="running",
    )
    if use_recorded_ai and not fixture_bundle:
        run.errors.append("내장 샘플과 해시가 다른 문서이므로 기록된 AI 응답을 재생하지 않고 규칙 엔진 결과만 표시함")

    _progress(progress, 25, "조항 나누는 중")
    t1 = time.perf_counter()
    old_clauses = segment_clauses(old_doc.id, "old", old_segments)
    new_clauses = segment_clauses(new_doc.id, "new", new_segments)
    timings["segment"] = int((time.perf_counter() - t1) * 1000)

    _progress(progress, 45, f"조항 정렬 중 (구판 {len(old_clauses)}개 · 신판 {len(new_clauses)}개)")
    t2 = time.perf_counter()
    alignments, aln_evidences, coverage = align_clauses_pipeline(
        project_id=project.id,
        old_doc=old_doc,
        new_doc=new_doc,
        old_clauses=old_clauses,
        new_clauses=new_clauses,
        old_segments=old_segments,
        new_segments=new_segments,
        max_group=MAX_ALIGNMENT_GROUP,
        fixture_alignments=fixture_bundle.get("alignments") if fixture_bundle else None,
    )
    timings["align"] = int((time.perf_counter() - t2) * 1000)

    _progress(progress, 70, "수치·기한·원문 근거 확인 중")
    t3 = time.perf_counter()
    ctx = {
        "project": project, "old_doc": old_doc, "new_doc": new_doc,
        "old_clauses": old_clauses, "new_clauses": new_clauses,
        "old_segments": old_segments, "new_segments": new_segments,
    }
    fx_changes = (fixture_bundle or {}).get("changes") or None
    changes, chg_evidences = _extract(ctx, alignments, fx_changes)
    checklist_items = build_checklist_items(project.id, changes)
    timings["extract"] = int((time.perf_counter() - t3) * 1000)

    has_invalid = any(ch.verification_status != "valid" for ch in changes)
    run.status = "partial" if (has_invalid or not coverage.is_complete) else "succeeded"
    project.status = "partial" if run.status == "partial" else "ready"
    project.latest_run_id = run.id
    run.finished_at = utc_now_iso()
    timings["total"] = int((time.perf_counter() - t0) * 1000)
    run.usage_if_available = {"llm_calls": 0, "is_fixture_replay": bool(fixture_bundle), "ai_executed": False, "timings_ms": timings}

    evidences = {e.id: e for e in aln_evidences + chg_evidences}
    _progress(progress, 100, "완료")
    return AnalysisState(
        project=project,
        old_doc=old_doc,
        new_doc=new_doc,
        old_segments=old_segments,
        new_segments=new_segments,
        old_clauses=old_clauses,
        new_clauses=new_clauses,
        alignments=alignments,
        changes=changes,
        checklist_items=checklist_items,
        coverage=coverage,
        run=run,
        evidences=evidences,
        alignment_evidence_ids=[e.id for e in aln_evidences],
        is_synthetic=is_synthetic,
        fixture_replay=bool(fixture_bundle),
        timings_ms=timings,
    )


# ---------------------------------------------------------------------------
# 사용자 키 LLM 보강 (브라우저가 호출, 엔진은 입력 준비·출력 검증·병합만)
# ---------------------------------------------------------------------------
def llm_targets(state: AnalysisState) -> List[Dict[str, Any]]:
    """LLM 에 보낼 대상: 원본 runner 와 같은 기준(완전 동일 조항은 제외)으로 바뀐 조항 묶음만 고른다."""
    old_by_id = {c.id: c for c in state.old_clauses}
    new_by_id = {c.id: c for c in state.new_clauses}
    out: List[Dict[str, Any]] = []
    for aln in state.alignments:
        if aln.method == "exact" and "format_only" not in aln.flags:
            continue
        key, old_nums, new_nums = _lookup_key(aln, old_by_id, new_by_id)
        out.append(
            {
                "lookup_key": key,
                "alignment_id": aln.id,
                "relationship": aln.relationship,
                "old_clauses": [{"number": old_by_id[c].clause_number, "text": old_by_id[c].text} for c in aln.old_clause_ids if c in old_by_id],
                "new_clauses": [{"number": new_by_id[c].clause_number, "text": new_by_id[c].text} for c in aln.new_clause_ids if c in new_by_id],
            }
        )
    return out[:MAX_LLM_CALLS_PER_RUN]


def normalize_llm_change(raw_obj: Any) -> Dict[str, Any]:
    """원본 provider._normalize_llm_dict(LLMChangeOutputSchema 분기)와 같은 보정. 형식이 틀리면 ValueError."""
    if isinstance(raw_obj, str):
        txt = raw_obj.strip()
        if txt.startswith("```"):
            txt = txt.strip("`")
            if txt.lower().startswith("json"):
                txt = txt[4:]
        raw_obj = json.loads(txt)
    if isinstance(raw_obj, list):
        if not raw_obj or not isinstance(raw_obj[0], dict):
            raise ValueError("응답 JSON이 유효한 객체 형태가 아닙니다.")
        data = dict(raw_obj[0])
    elif isinstance(raw_obj, dict):
        data = dict(raw_obj)
    else:
        raise ValueError("응답 JSON이 dict가 아닙니다.")

    if "summary_ko" not in data:
        for alt in ("difference_summary", "summary", "change_summary", "description_ko", "description"):
            if data.get(alt):
                data["summary_ko"] = str(data[alt])
                break
    if "categories" not in data or not data["categories"]:
        cat_val = data.get("category")
        data["categories"] = ([cat_val] if isinstance(cat_val, str) else list(cat_val)) if cat_val else ["기타"]
    elif isinstance(data["categories"], str):
        data["categories"] = [data["categories"]]
    sem = str(data.get("semantic_status") or data.get("status") or "changed").strip().lower()
    data["semantic_status"] = sem if sem in VALID_SEMANTIC else "changed"
    for key in ("summary_ko", "old_fact", "new_fact", "scope_conditions"):
        val = data.get(key)
        data[key] = "" if val is None else str(val)
    for key in ("changed_obligations", "uncertainties"):
        val = data.get(key)
        if val is None:
            data[key] = []
        elif isinstance(val, str):
            data[key] = [val] if val.strip() else []
        elif isinstance(val, list):
            data[key] = [str(x) for x in val if x is not None]
        else:
            data[key] = []
    for key in ("old_quote", "new_quote"):
        if data.get(key) is not None:
            data[key] = str(data[key])
    if not data["summary_ko"].strip():
        raise ValueError("필수 필드 summary_ko가 비어 있습니다.")
    keep = ("categories", "semantic_status", "summary_ko", "old_fact", "new_fact", "changed_obligations", "scope_conditions", "uncertainties", "old_quote", "new_quote")
    return {k: data[k] for k in keep if k in data}


def apply_llm_outputs(
    state: AnalysisState,
    outputs: Dict[str, Any],
    *,
    provider: str = "openai_compat",
    model: str = "",
    calls: int = 0,
    total_tokens: Optional[int] = None,
    errors: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """LLM 응답(lookup_key → JSON)을 검증해 원본 엔진 방식으로 변경 결과에 병합하고 근거를 다시 검증한다."""
    accepted: Dict[str, Dict[str, Any]] = {}
    rejected: Dict[str, str] = {}
    for key, raw in (outputs or {}).items():
        try:
            accepted[str(key)] = normalize_llm_change(raw)
        except Exception as exc:  # 잘린 응답·형식 오류는 성공으로 표시하지 않는다 (T9)
            rejected[str(key)] = f"{type(exc).__name__}: {exc}"

    merged = dict(state.llm_outputs)
    merged.update(accepted)
    ctx = {
        "project": state.project, "old_doc": state.old_doc, "new_doc": state.new_doc,
        "old_clauses": state.old_clauses, "new_clauses": state.new_clauses,
        "old_segments": state.old_segments, "new_segments": state.new_segments,
    }
    changes, chg_evidences = _extract(ctx, state.alignments, merged or None)
    state.changes = changes
    state.checklist_items = build_checklist_items(state.project.id, changes)
    keep = {eid: state.evidences[eid] for eid in state.alignment_evidence_ids if eid in state.evidences}
    keep.update({e.id: e for e in chg_evidences})
    state.evidences = keep
    state.llm_outputs = merged
    state.fixture_replay = False
    state.reviews = []  # 결과가 바뀌었으므로 이전 검토를 승계하지 않는다 ([C], T10)

    run = state.run
    run.mode = "live"
    run.provider = provider
    run.model_name = model or "unknown"
    run.finished_at = utc_now_iso()
    run.errors = [e for e in run.errors if not e.startswith("[LLM]")] + [f"[LLM] {k}: {v}" for k, v in rejected.items()] + [
        f"[LLM] {e}" for e in (errors or [])
    ]
    has_invalid = any(ch.verification_status != "valid" for ch in changes)
    run.status = "partial" if (has_invalid or not state.coverage.is_complete or rejected or errors) else "succeeded"
    usage = dict(run.usage_if_available or {})
    usage.update({"llm_calls": int(calls), "total_tokens": total_tokens, "ai_executed": bool(accepted), "is_fixture_replay": False})
    run.usage_if_available = usage
    state.llm_meta = {"provider": provider, "model": model, "accepted": len(accepted), "rejected": rejected}
    return {"accepted": sorted(accepted), "rejected": rejected}


# ---------------------------------------------------------------------------
# 담당자 검토 (브라우저 메모리. 결과 파일에 검토 상태가 함께 나간다)
# ---------------------------------------------------------------------------
_DECISIONS = {"unreviewed", "confirmed", "modified", "rejected"}


def set_review(state: AnalysisState, kind: str, result_id: str, decision: str, note: str = "", reviewer_label: str = "담당자") -> Dict[str, Any]:
    if decision not in _DECISIONS:
        raise AppException(code="VALIDATION_ERROR", message_ko=f"검토 결정 값이 올바르지 않습니다: {decision}")
    pool: List[Any]
    if kind == "change":
        pool = state.changes
    elif kind == "checklist":
        pool = state.checklist_items
    elif kind == "alignment":
        pool = state.alignments
    else:
        raise AppException(code="VALIDATION_ERROR", message_ko=f"검토 대상 종류가 올바르지 않습니다: {kind}")
    target = next((x for x in pool if x.id == result_id), None)
    if target is None:
        raise AppException(code="NOT_FOUND", message_ko="검토할 결과를 찾을 수 없습니다.", status_code=404)
    target.review_status = decision
    if hasattr(target, "reviewer_note"):
        target.reviewer_note = note
    target.revision = int(getattr(target, "revision", 1)) + 1
    review = Review(
        id=f"rev-{uuid.uuid4().hex[:10]}",
        result_id=result_id,
        result_kind=kind,
        result_revision=target.revision,
        decision=decision,
        reviewer_label=reviewer_label,
        note=note,
    )
    state.reviews.append(review)
    return review.to_dict()


# ---------------------------------------------------------------------------
# 화면용 JSON · 내보내기
# ---------------------------------------------------------------------------
def to_view(state: AnalysisState) -> Dict[str, Any]:
    """화면에 필요한 결과 전체를 JSON 직렬화 가능한 dict 로 만든다."""
    from .exporter import gather_export_bundle

    bundle = gather_export_bundle(state)
    seg_ids = {e.segment_id for e in state.evidences.values()}
    segs = {s.id: s for s in state.old_segments + state.new_segments}
    return {
        "engine_version": ENGINE_VERSION,
        "project": state.project.to_dict(),
        "documents": {"old": state.old_doc.to_dict(), "new": state.new_doc.to_dict()},
        "clauses": {
            "old": [_clause_view(c) for c in state.old_clauses],
            "new": [_clause_view(c) for c in state.new_clauses],
        },
        "alignments": [a.to_dict() for a in state.alignments],
        "changes": [c.to_dict() for c in state.changes],
        "checklist_items": [i.to_dict() for i in state.checklist_items],
        "coverage": state.coverage.to_dict(),
        "run": state.run.to_dict(),
        "evidences": {eid: e.to_dict() for eid, e in state.evidences.items()},
        "segments": {sid: {"id": sid, "locator": segs[sid].locator, "raw_text": segs[sid].raw_text, "heading_path": segs[sid].heading_path} for sid in seg_ids if sid in segs},
        "notices": {
            "synthetic": bundle["synthetic_notice"],
            "mode": bundle["mode_notice"],
            "completeness": bundle["completeness_notice"],
            "export_version": bundle["export_version"],
        },
        "is_synthetic": state.is_synthetic,
        "fixture_replay": state.fixture_replay,
        "llm": state.llm_meta,
        "reviews": [r.to_dict() for r in state.reviews],
        "timings_ms": state.timings_ms,
    }


def _clause_view(c: Clause) -> Dict[str, Any]:
    return {
        "id": c.id,
        "clause_number": c.clause_number,
        "heading_path": c.heading_path,
        "text": c.text,
        "locator": c.locator,
        "sequence_no": c.sequence_no,
        "segment_ids": c.segment_ids,
        "version_side": c.version_side,
    }


def export(state: AnalysisState, fmt: str) -> Tuple[bytes, str, str]:
    return export_project_artifact(state, fmt)
