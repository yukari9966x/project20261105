"""의미 변화 추출기(ChangeExtractor) 및 대응 체크리스트 빌더(ChecklistBuilder) ([H2-4])."""
from __future__ import annotations

import difflib
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from .numeric_date import (
    compare_numeric_facts,
    detect_modality,
    extract_and_compare_dates,
    extract_numeric_facts,
    extract_standard_citations,
)
from .segmenter import strip_clause_prefix
from .schemas import (
    Alignment,
    Change,
    ChecklistItem,
    Clause,
    DateDelta,
    Document,
    Evidence,
    NumericDelta,
    Segment,
)
from .verifier import create_and_verify_evidence

# 9대 공식 변경 범주 ([H2-4])
VALID_CATEGORIES = [
    "시험방법",
    "인증/적합성평가",
    "표시/설명서",
    "기술적 허용치",
    "적용범위/예외",
    "시행일/유예기간",
    "인용표준",
    "용어",
    "기타",
]


def classify_categories(
    old_text: str,
    new_text: str,
    numeric_deltas: List[NumericDelta],
    date_deltas: List[DateDelta],
) -> List[str]:
    cats: List[str] = []
    combined = f"{old_text}\n{new_text}".lower()

    if numeric_deltas:
        cats.append("기술적 허용치")
    if date_deltas or any(k in combined for k in ("시행일", "유예기간", "경과조치", "부칙", "effective date", "grace period", "transition")):
        cats.append("시행일/유예기간")

    old_stds = set(extract_standard_citations(old_text))
    new_stds = set(extract_standard_citations(new_text))
    if old_stds != new_stds:
        cats.append("인용표준")

    if any(k in combined for k in ("시험방법", "시험조건", "측정방법", "열폭주", "과충전", "test method", "thermal runaway", "test procedure")):
        if "시험방법" not in cats:
            cats.append("시험방법")
    if any(k in combined for k in ("인증", "적합성", "형식승인", "자율안전", "제3자", "certification", "conformity assessment", "type examination", "module")):
        cats.append("인증/적합성평가")
    if any(k in combined for k in ("표시", "명판", "라벨", "설명서", "경고문", "marking", "label", "instruction manual", "warning")):
        cats.append("표시/설명서")
    if any(k in combined for k in ("적용범위", "예외", "면제", "제외", "대상", "scope", "exempt", "exclusion")):
        cats.append("적용범위/예외")
    if any(k in combined for k in ("정의", "용어", "이라 함은", "definition", "terminology")):
        cats.append("용어")

    if not cats:
        cats.append("기타")
    return cats


def _find_best_quote_in_clauses(
    clauses: List[Clause], segs_by_id: Optional[Dict[str, Segment]] = None
) -> Tuple[Optional[str], str]:
    """조항 목록에서 첫 유효 segment_id와 그 세그먼트 안에 실제로 들어 있는 원문 인용문을 반환한다.

    조항이 여러 세그먼트(머리 문단 + ①②항 문단 등)로 이루어진 경우에도 인용문이 세그먼트 경계를
    넘지 않도록 첫 세그먼트의 원문에서만 인용한다 (넘으면 근거 검증이 실패함).
    """
    for cl in clauses:
        if not (cl.segment_ids and cl.text.strip()):
            continue
        seg_id = cl.segment_ids[0]
        source = cl.text
        if segs_by_id and seg_id in segs_by_id and segs_by_id[seg_id].raw_text.strip():
            source = segs_by_id[seg_id].raw_text
        lines = [ln.strip() for ln in source.splitlines() if ln.strip()]
        quote = lines[0] if lines else source.strip()
        if len(lines) > 1 and len(quote) < 35:
            quote = f"{lines[0]}\n{lines[1]}"
        if len(quote) > 160:
            quote = quote[:160]
        return seg_id, quote
    return None, ""


def _norm_line(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()


def _find_changed_quote(
    clauses: List[Clause],
    other_clauses: List[Clause],
    segs_by_id: Dict[str, Segment],
) -> Tuple[Optional[str], str]:
    """상대 판본에 없는(=바뀐) 첫 줄을 그 줄이 들어 있는 세그먼트와 함께 돌려준다.

    근거 패널에서 조항 머리글만이 아니라 실제로 바뀐 문장을 바로 보여주기 위함이다.
    바뀐 줄을 찾지 못하면 (None, "")을 돌려주고 호출부는 기본 인용(첫 줄)을 쓴다.
    """
    other_lines = {
        _norm_line(ln)
        for c in other_clauses
        for ln in c.text.splitlines()
        if ln.strip()
    }
    for cl in clauses:
        for sid in cl.segment_ids:
            seg = segs_by_id.get(sid)
            if seg is None:
                continue
            for ln in seg.raw_text.splitlines():
                if ln.strip() and _norm_line(ln) not in other_lines:
                    q = ln.strip()
                    return sid, (q[:160] if len(q) > 160 else q)
    return None, ""


def _wording_diff(old_text: str, new_text: str, max_ops: int = 2, max_len: int = 60) -> str:
    """구판·신판 본문의 어절 단위 차이를 «구» → «신» 형태로 짧게 요약한다 (AI 없이도 무엇이 바뀌었는지 표시)."""
    a = old_text.split()
    b = new_text.split()
    if a == b:
        return ""

    def clip(words: List[str]) -> str:
        t = " ".join(words)
        return t if len(t) <= max_len else t[: max_len - 1] + "…"

    parts: List[str] = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        if tag == "replace":
            parts.append(f"«{clip(a[i1:i2])}» → «{clip(b[j1:j2])}»")
        elif tag == "insert":
            parts.append(f"«{clip(b[j1:j2])}» 추가")
        elif tag == "delete":
            parts.append(f"«{clip(a[i1:i2])}» 삭제")
        if len(parts) >= max_ops:
            break
    return "문구 변경: " + ", ".join(parts) if parts else ""


def extract_changes_for_alignments(
    project_id: str,
    old_doc: Document,
    new_doc: Document,
    old_clauses: List[Clause],
    new_clauses: List[Clause],
    old_segments: List[Segment],
    new_segments: List[Segment],
    alignments: List[Alignment],
    fixture_changes: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Tuple[List[Change], List[Evidence]]:
    """정렬된 각 Alignment에 대해 의미 변화, 수치/단위, 시행일/기한, 원문 근거를 추출·검증한다."""
    old_by_id = {c.id: c for c in old_clauses}
    new_by_id = {c.id: c for c in new_clauses}
    old_segs_by_id = {s.id: s for s in old_segments}
    new_segs_by_id = {s.id: s for s in new_segments}

    changes: List[Change] = []
    evidences: List[Evidence] = []

    for idx, aln in enumerate(alignments, start=1):
        ocl_list = [old_by_id[cid] for cid in aln.old_clause_ids if cid in old_by_id]
        ncl_list = [new_by_id[cid] for cid in aln.new_clause_ids if cid in new_by_id]
        old_text = "\n".join(c.text for c in ocl_list).strip()
        new_text = "\n".join(c.text for c in ncl_list).strip()

        old_nums_str = ", ".join(c.clause_number or c.id for c in ocl_list)
        new_nums_str = ", ".join(c.clause_number or c.id for c in ncl_list)
        lookup_key = f"{old_nums_str}->{new_nums_str}"

        fx = (fixture_changes or {}).get(lookup_key) or (fixture_changes or {}).get(old_nums_str) or (fixture_changes or {}).get(new_nums_str)

        # 1. 양쪽 원문 근거(Evidence) 생성 및 검증 ([C], [H2-4])
        ev_old_ids: List[str] = []
        ev_new_ids: List[str] = []

        is_changed_pair = bool(ocl_list and ncl_list) and not (aln.method == "exact")
        if ocl_list:
            seg_id, quote = _find_best_quote_in_clauses(ocl_list, old_segs_by_id)
            if is_changed_pair:
                c_sid, c_quote = _find_changed_quote(ocl_list, ncl_list, old_segs_by_id)
                if c_sid:
                    seg_id, quote = c_sid, c_quote
            if fx and fx.get("old_quote"):
                # fixture가 지정한 인용구가 실제 조항에 존재하는지 검증
                cand_q = fx["old_quote"]
                matched_seg_id = seg_id
                for c in ocl_list:
                    for sid in c.segment_ids:
                        if sid in old_segs_by_id and cand_q in old_segs_by_id[sid].raw_text:
                            matched_seg_id = sid
                            break
                ev_o = create_and_verify_evidence(old_doc, old_segs_by_id, matched_seg_id or "", cand_q)
            else:
                ev_o = create_and_verify_evidence(old_doc, old_segs_by_id, seg_id or "", quote)
            evidences.append(ev_o)
            ev_old_ids.append(ev_o.id)

        if ncl_list:
            seg_id, quote = _find_best_quote_in_clauses(ncl_list, new_segs_by_id)
            if is_changed_pair:
                c_sid, c_quote = _find_changed_quote(ncl_list, ocl_list, new_segs_by_id)
                if c_sid:
                    seg_id, quote = c_sid, c_quote
            if fx and fx.get("new_quote"):
                cand_q = fx["new_quote"]
                matched_seg_id = seg_id
                for c in ncl_list:
                    for sid in c.segment_ids:
                        if sid in new_segs_by_id and cand_q in new_segs_by_id[sid].raw_text:
                            matched_seg_id = sid
                            break
                ev_n = create_and_verify_evidence(new_doc, new_segs_by_id, matched_seg_id or "", cand_q)
            else:
                ev_n = create_and_verify_evidence(new_doc, new_segs_by_id, seg_id or "", quote)
            evidences.append(ev_n)
            ev_new_ids.append(ev_n.id)

        # 근거 검증 상태 종합
        related_evs = [e for e in evidences if e.id in (ev_old_ids + ev_new_ids)]
        if not related_evs or any(e.verification_status == "missing" for e in related_evs):
            ver_status = "missing"
        elif any(e.verification_status == "invalid" for e in related_evs):
            ver_status = "invalid"
        else:
            ver_status = "valid"

        # 2. 미매칭(신설 후보 / 삭제 후보) 조항 처리 ([H2-3.7], [H2-4], T4)
        if aln.relationship == "unmatched_old":
            cats = classify_categories(old_text, "", [], [])
            changes.append(
                Change(
                    id=f"chg-{project_id}-{idx:03d}",
                    project_id=project_id,
                    alignment_id=aln.id,
                    categories=cats,
                    semantic_status="deletion_candidate",
                    summary_ko=(
                        fx.get("summary_ko")
                        if fx and fx.get("summary_ko")
                        else f"[삭제 후보 / 미해결] 구판 {old_nums_str} 조항이 신판 비교범위 내에서 대응 조항이 검색되지 않음 (담당자 최종 확인 전까지 삭제 확정 보류)"
                    ),
                    old_fact=old_text[:300],
                    new_fact="[신판 대응 조항 미발견 — 비교범위 전체 대조 결과 대응 문구 없음]",
                    changed_obligations=fx.get("changed_obligations", ["구판 의무조항 삭제 후보 여부 담당자 확인 필요"]) if fx else ["구판 의무조항 삭제 후보 여부 담당자 확인 필요"],
                    numeric_deltas=[],
                    date_deltas=[],
                    scope_conditions="전체 비교범위 내 신판 미대응",
                    uncertainties=["검색 미매칭만으로는 법령 삭제를 자동 확정하지 않으며 담당자 확인이 필요함"],
                    evidence_old_ids=ev_old_ids,
                    evidence_new_ids=[],
                    verification_status=ver_status,
                    review_status="unreviewed",
                    is_stale=False,
                    revision=1,
                )
            )
            continue

        if aln.relationship == "unmatched_new":
            old_facts = []
            new_facts = extract_numeric_facts(new_text, ev_new_ids)
            date_deltas = extract_and_compare_dates("", new_text)
            cats = classify_categories("", new_text, [], date_deltas)
            changes.append(
                Change(
                    id=f"chg-{project_id}-{idx:03d}",
                    project_id=project_id,
                    alignment_id=aln.id,
                    categories=cats,
                    semantic_status="addition_candidate",
                    summary_ko=(
                        fx.get("summary_ko")
                        if fx and fx.get("summary_ko")
                        else f"[신설 후보 / 미해결] 신판 {new_nums_str} 조항이 구판 비교범위 내에서 대응 조항이 검색되지 않음 (담당자 최종 확인 전까지 신설 확정 보류)"
                    ),
                    old_fact="[구판 대응 조항 미발견 — 비교범위 전체 대조 결과 대응 문구 없음]",
                    new_fact=new_text[:300],
                    changed_obligations=fx.get("changed_obligations", ["신판 신규 의무 후보 조항 담당자 검토 필요"]) if fx else ["신판 신규 의무 후보 조항 담당자 검토 필요"],
                    numeric_deltas=[],
                    date_deltas=date_deltas,
                    scope_conditions="전체 비교범위 내 구판 미대응",
                    uncertainties=["검색 미매칭만으로는 조항 신설을 자동 확정하지 않으며 담당자 확인이 필요함"],
                    evidence_old_ids=[],
                    evidence_new_ids=ev_new_ids,
                    verification_status=ver_status,
                    review_status="unreviewed",
                    is_stale=False,
                    revision=1,
                )
            )
            continue

        # 3. 수치·단위·기한 비교
        old_num_facts = extract_numeric_facts(old_text, ev_old_ids)
        new_num_facts = extract_numeric_facts(new_text, ev_new_ids)
        numeric_deltas = compare_numeric_facts(old_num_facts, new_num_facts)
        date_deltas = extract_and_compare_dates(old_text, new_text)

        # 4. 완전 동일 / 번호 이동만 있는 경우 / 서식만 변경된 경우 구분 (T2)
        old_body_clean = strip_clause_prefix(old_text)
        new_body_clean = strip_clause_prefix(new_text)

        if "format_only" in aln.flags:
            sem_status = "format_only"
            summary = f"서식/문장부호만 정리되었으며 실질 의무 및 기준치는 동일함 ({old_nums_str} → {new_nums_str})"
            cats = classify_categories(old_text, new_text, numeric_deltas, date_deltas)
            changes.append(
                Change(
                    id=f"chg-{project_id}-{idx:03d}",
                    project_id=project_id,
                    alignment_id=aln.id,
                    categories=cats,
                    semantic_status=sem_status,
                    summary_ko=fx.get("summary_ko", summary) if fx else summary,
                    old_fact=old_text[:280],
                    new_fact=new_text[:280],
                    changed_obligations=[],
                    numeric_deltas=numeric_deltas,
                    date_deltas=date_deltas,
                    scope_conditions="서식 변경 외 조건 동일",
                    uncertainties=[],
                    evidence_old_ids=ev_old_ids,
                    evidence_new_ids=ev_new_ids,
                    verification_status=ver_status,
                    review_status="unreviewed",
                    is_stale=False,
                    revision=1,
                )
            )
            continue

        if aln.method == "exact" and old_body_clean == new_body_clean:
            sem_status = "unchanged"
            if "moved" in aln.flags:
                summary = f"조항 번호만 이동({old_nums_str} → {new_nums_str})되었으며 실질 규정 내용은 변경 없음"
            else:
                summary = f"구판({old_nums_str})과 신판({new_nums_str}) 조항 내용 완전 동일"
            cats = classify_categories(old_text, new_text, numeric_deltas, date_deltas)
            changes.append(
                Change(
                    id=f"chg-{project_id}-{idx:03d}",
                    project_id=project_id,
                    alignment_id=aln.id,
                    categories=cats,
                    semantic_status=sem_status,
                    summary_ko=fx.get("summary_ko", summary) if fx else summary,
                    old_fact=old_text[:280],
                    new_fact=new_text[:280],
                    changed_obligations=[],
                    numeric_deltas=numeric_deltas,
                    date_deltas=date_deltas,
                    scope_conditions="동일",
                    uncertainties=[],
                    evidence_old_ids=ev_old_ids,
                    evidence_new_ids=ev_new_ids,
                    verification_status=ver_status,
                    review_status="unreviewed",
                    is_stale=False,
                    revision=1,
                )
            )
            continue

        # 5. 실질 변경 또는 단위 동등 분석
        cats = classify_categories(old_text, new_text, numeric_deltas, date_deltas)
        if fx and fx.get("categories"):
            cats = [c for c in fx["categories"] if c in VALID_CATEGORIES] or cats

        # 부정어/의무성 변경 탐지 (shall vs shall not, 면제한다 vs 면제하지 아니한다)
        old_mod = detect_modality(old_text)
        new_mod = detect_modality(new_text)
        negation_changed = (old_mod != new_mod) or (
            ("면제한다" in old_text and "면제하지 아니한다" in new_text)
            or ("shall be exempted" in old_text.lower() and "shall not be exempted" in new_text.lower())
        )

        # 인용표준 판본 변화 탐지
        old_stds = extract_standard_citations(old_text)
        new_stds = extract_standard_citations(new_text)

        # 표 셀 변화 탐지
        has_table_diff = any(c.table_cells for c in ocl_list + ncl_list) and (old_text != new_text)

        summary_parts: List[str] = []
        obligations: List[str] = []
        uncertainties: List[str] = []

        if "moved" in aln.flags:
            summary_parts.append(f"[번호이동 {old_nums_str}→{new_nums_str} + 내용변경]")
        if "split" in aln.flags:
            summary_parts.append(f"[조항분할 {old_nums_str}→{new_nums_str}]")
        if "merged" in aln.flags:
            summary_parts.append(f"[조항병합 {old_nums_str}→{new_nums_str}]")

        if negation_changed:
            summary_parts.append("의무/부정어 규정 변경(면제·허용 → 의무·금지 전환)")
            obligations.append("면제 또는 임의 규정이 강제(또는 금지) 의무로 변경되어 대상 여부 재검토 필요")

        for nd in numeric_deltas:
            same_raw = (
                nd.status == "numeric_equivalent"
                and nd.old_fact is not None
                and nd.new_fact is not None
                and f"{nd.old_fact.raw_value}{nd.old_fact.raw_unit}" == f"{nd.new_fact.raw_value}{nd.new_fact.raw_unit}"
            )
            if same_raw:
                continue  # 표기까지 같은 수치(50K = 50K)는 요약에서 생략 (데이터에는 남김)
            summary_parts.append(nd.summary_ko)
            if nd.status in ("tightened", "relaxed", "boundary_changed"):
                obligations.append(f"기술 기준치 변경 확인: {nd.summary_ko}")
            elif nd.status in ("condition_changed_review", "unit_unsupported_review", "value_changed_review"):
                uncertainties.append(nd.reason_ko)
                obligations.append(f"시험조건/단위 변경에 따른 담당자 검토: {nd.summary_ko}")

        if set(old_stds) != set(new_stds):
            std_msg = f"인용표준 판본 변경 ({', '.join(old_stds) or '없음'} → {', '.join(new_stds) or '없음'})"
            summary_parts.append(std_msg)
            obligations.append(f"적용 인용표준 판본 업데이트 확인: {', '.join(new_stds)}")

        if has_table_diff:
            summary_parts.append("표(Table) 셀 시험항목/기준값 변경")
            obligations.append("개정된 표 항목별 시험조건 및 판정기준 대조 확인")

        role_ko = {
            "effective_date": "시행일",
            "grace_period_end": "유예 종료일",
            "manufacturing_date_basis": "제조일 기준",
            "import_date_basis": "수입일(통관) 기준",
            "relative_period": "상대 기한",
        }
        for dd in date_deltas:
            summary_parts.append(f"{role_ko.get(dd.role, '기한')}: {dd.new_date_raw} ({dd.basis_note_ko})")
            if dd.status == "unconfirmed":
                uncertainties.append(dd.basis_note_ko)

        wording = _wording_diff(old_body_clean, new_body_clean)
        if wording:
            summary_parts.append(wording)

        if fx and fx.get("summary_ko"):
            final_summary = fx["summary_ko"]
        elif summary_parts:
            final_summary = " / ".join(summary_parts)
        else:
            final_summary = f"조항({old_nums_str} → {new_nums_str}) 요구사항 및 문구 개정"

        if fx and fx.get("changed_obligations"):
            obligations = list(fx["changed_obligations"])
        elif not obligations:
            obligations = [f"{new_nums_str} 개정 문구에 따른 표시·시험·인증 요구사항 확인"]

        if fx and fx.get("uncertainties"):
            for u in fx["uncertainties"]:
                if u not in uncertainties:
                    uncertainties.append(u)

        sem_status = fx.get("semantic_status", "changed") if fx else "changed"
        if ver_status != "valid":
            sem_status = "unresolved"
            uncertainties.append("원문 근거(Evidence) 검증 실패 또는 누락으로 인해 미해결 상태로 분류됨")

        changes.append(
            Change(
                id=f"chg-{project_id}-{idx:03d}",
                project_id=project_id,
                alignment_id=aln.id,
                categories=cats,
                semantic_status=sem_status,
                summary_ko=final_summary,
                old_fact=fx.get("old_fact", old_text[:300]) if fx else old_text[:300],
                new_fact=fx.get("new_fact", new_text[:300]) if fx else new_text[:300],
                changed_obligations=obligations,
                numeric_deltas=numeric_deltas,
                date_deltas=date_deltas,
                scope_conditions=fx.get("scope_conditions", "구판/신판 조항 직접 대응") if fx else "구판/신판 조항 직접 대응",
                uncertainties=uncertainties,
                evidence_old_ids=ev_old_ids,
                evidence_new_ids=ev_new_ids,
                verification_status=ver_status,
                review_status="unreviewed",
                is_stale=False,
                revision=1,
            )
        )

    return changes, evidences


def build_checklist_items(
    project_id: str,
    changes: List[Change],
    project_level_dates: Optional[List[DateDelta]] = None,
) -> List[ChecklistItem]:
    """검증된(verification_status == 'valid') Change만 사용하여 대응 체크리스트 초안을 생성한다 ([H2-4], T7, T9).

    - 근거가 없거나 깨진 사실(invalid/missing)은 체크리스트에 쓰지 않는다.
    - 존재하지 않는 기업명·담당자·확정기한을 창작하지 않는다.
    - 미확정 기한은 체크리스트에서 절대 확정(confirmed)하지 않는다.
    """
    items: List[ChecklistItem] = []

    # 프로젝트 내 시행일/유예기간 조항에서 파악된 공통 기한 참조
    global_dates = list(project_level_dates or [])
    for ch in changes:
        if ch.verification_status == "valid" and ch.date_deltas:
            global_dates.extend(ch.date_deltas)

    default_due: Optional[str] = None
    default_due_status = "unconfirmed"
    for gd in global_dates:
        if gd.status == "confirmed" and gd.resolved_date:
            default_due = gd.resolved_date
            default_due_status = "confirmed"
            break

    seq = 0
    for ch in changes:
        # 1. 근거 검증이 실패(invalid/missing)한 항목은 자동 체크리스트 생성에서 제외 ([C], [H2-4], T9)
        if ch.verification_status != "valid":
            continue

        # 2. 실질 변경이 없는 항목(unchanged / format_only)은 제외하되, 단위동등 확인이 필요한 경우만 포함 가능
        if ch.semantic_status in ("unchanged", "format_only"):
            continue

        seq += 1
        # 기한 산정 (미확정 기한은 절대 확정으로 바꾸지 않음 - T7)
        due_date: Optional[str] = None
        due_status = "unconfirmed"
        if ch.date_deltas:
            first_d = ch.date_deltas[0]
            if first_d.status == "confirmed" and first_d.resolved_date:
                due_date = first_d.resolved_date
                due_status = "confirmed"
            else:
                due_date = None
                due_status = "unconfirmed"
        elif default_due and default_due_status == "confirmed" and ch.semantic_status == "changed":
            due_date = default_due
            due_status = "confirmed"

        # 행동 지침(action_ko), 확인 질문, 준비 자료 구성
        cat_str = ", ".join(ch.categories)
        if ch.semantic_status in ("addition_candidate", "deletion_candidate", "unresolved"):
            action_ko = f"[초안/미해결 확인] {ch.summary_ko[:90]} 관련 신설·삭제 여부 원문 대조 확인"
            question = "해당 조항이 타 장/별표로 이동된 것이 아닌 실제 신설/삭제인지 담당자가 확인하였는가?"
            evidence_prep = "구판·신판 전체 목차 대조표 및 국표원 담당자 검토 의견서"
            priority_reason = "신설/삭제 후보 미해결 조항 — 확정 전 우선 검토 필요"
            due_date = None
            due_status = "unconfirmed"
        elif "인용표준" in ch.categories:
            action_ko = f"[초안] {ch.changed_obligations[0] if ch.changed_obligations else ch.summary_ko} — 시험기관에 신규 인용표준 판본 적용 여부 확인"
            question = "기존 성적서의 인용표준 판본이 신판 기준과 일치하는가? 추가 차분 시험이 필요한가?"
            evidence_prep = "기존 공인시험성적서 표준 판본 내역 및 시험기관 판본 비교 확인서"
            priority_reason = f"인용표준 판본 변경 ({cat_str})"
        elif "표시/설명서" in ch.categories:
            action_ko = f"[초안] 제품 명판·라벨 표시문구 및 사용자 설명서 개정안 검토 ({ch.summary_ko[:70]})"
            question = "신판에서 요구하는 필수 표시사항·경고문구가 명판 및 설명서 도안에 반영되었는가?"
            evidence_prep = "개정 명판 라벨 시안 및 사용자 설명서 원고"
            priority_reason = f"표시/설명서 의무 변경 ({cat_str})"
        elif "인증/적합성평가" in ch.categories:
            action_ko = f"[초안] 지정 인증기관에 적합성평가 절차 변경사항 및 인증서 갱신 대상 여부 확인 ({ch.summary_ko[:70]})"
            question = "적합성평가 방식 변경에 따라 신규 형식시험 또는 인증서 변경 신청이 필요한가?"
            evidence_prep = "현행 인증서 사본, 기술문서(TCF) 및 인증기관 질의 회신서"
            priority_reason = f"인증/적합성평가 의무 변경 ({cat_str})"
        else:
            action_ko = f"[초안] {ch.changed_obligations[0] if ch.changed_obligations else ch.summary_ko[:80]} 검토 및 시험성적서 확인"
            question = "변경된 기술 기준치·시험조건을 현행 제품 사양이 충족하는지 시험 데이터로 확인하였는가?"
            evidence_prep = "사양 비교표 및 개정 시험조건 기준 시험성적서"
            priority_reason = f"기술규정 변경 ({cat_str})"

        items.append(
            ChecklistItem(
                id=f"chk-{project_id}-{seq:03d}",
                project_id=project_id,
                change_id=ch.id,
                action_ko=action_ko,
                applicable_condition=ch.scope_conditions or "해당 제품군 적용 대상",
                due_date=due_date,
                due_date_status=due_status,
                priority_reason=priority_reason,
                verification_question=question,
                suggested_evidence_to_prepare=evidence_prep,
                owner_placeholder="담당자 미지정 (확인 필요)",
                review_status="unreviewed",
                is_stale=False,
                revision=1,
            )
        )

    return items
