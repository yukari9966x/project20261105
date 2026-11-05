"""다중 포맷 내보내기(JSON, XLSX 7시트, Markdown, DOCX, 인쇄용 HTML) 및 수식 주입 방어 모듈 ([E], [F], [H2-5], T12).

브라우저(Pyodide) 이식판: 원본은 SQLite(Repository)에서 결과를 읽었지만, 여기서는 pipeline.AnalysisState
(브라우저 메모리)에서 묶음을 만든다. 파일은 브라우저 안에서 만들어 사용자 PC 로 바로 내려받는다.
"""
from __future__ import annotations

import html
import io
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import docx
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls
from docx.shared import Inches, Pt, RGBColor
import openpyxl
from openpyxl.styles import Alignment as XLAlignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

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
    utc_now_iso,
)

SYNTHETIC_NOTICE_KO = "⚠️ [가상 규정, 실제 준수 판단용 아님] 본 결과물은 시제품 검증용 가상 기술규정 대조 결과이며 실제 법적 효력이나 적합성 인증 판단 근거로 사용할 수 없습니다."
USER_DOC_NOTICE_KO = "ℹ️ [자동 대조 초안] 규칙 엔진이 만든 검토용 초안이며 법적 판단 근거가 아닙니다. 원문 근거를 확인한 뒤 담당자가 확정하세요."
RULE_MODE_NOTICE_KO = "ℹ️ [규칙 엔진 결과 / AI 미사용] 브라우저 안에서 규칙 엔진만으로 분석했습니다. 문서는 PC 밖으로 나가지 않았습니다."
LIVE_MODE_NOTICE_KO = "⚡ [AI 요약 포함] 바뀐 조항만 사용자가 설정한 LLM 주소로 보내 요약·의무사항을 보강했습니다."

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def sanitize_spreadsheet_cell(val: Any) -> str:
    """CSV/XLSX 내보내기 시 수식 주입(Formula Injection)을 방지한다 ([E])."""
    if val is None:
        return ""
    s = str(val)
    if s.startswith(FORMULA_PREFIXES):
        return "'" + s
    return s


def gather_export_bundle(state: Any) -> Dict[str, Any]:
    """pipeline.AnalysisState(브라우저 메모리)에서 내보내기 묶음을 만든다."""
    project = state.project
    old_docs = [state.old_doc]
    new_docs = [state.new_doc]
    old_clauses = state.old_clauses
    new_clauses = state.new_clauses
    alignments = state.alignments
    changes = state.changes
    checklist_items = state.checklist_items
    coverage = state.coverage
    latest_run = state.run

    all_ev_ids: List[str] = []
    for al in alignments:
        all_ev_ids.extend(al.evidence_ids)
    for ch in changes:
        all_ev_ids.extend(ch.evidence_old_ids)
        all_ev_ids.extend(ch.evidence_new_ids)
    wanted = set(all_ev_ids)
    evidences_map = {eid: ev for eid, ev in state.evidences.items() if eid in wanted}

    old_cl_map = {c.id: c for c in old_clauses}
    new_cl_map = {c.id: c for c in new_clauses}

    total_revisions = sum(al.revision for al in alignments) + sum(ch.revision for ch in changes)
    export_version_tag = f"rev{total_revisions}"

    mode_banner = LIVE_MODE_NOTICE_KO if (latest_run and latest_run.mode == "live") else RULE_MODE_NOTICE_KO

    completeness_banner = (
        "전체 조항 커버리지 검증 완료 (누락·중복 0건)"
        if (coverage and coverage.is_complete and coverage.unresolved_old == 0 and coverage.unresolved_new == 0)
        else f"⚠️ 미해결/미확정 항목 존재 (구판 미해결 {coverage.unresolved_old if coverage else 0}건, 신판 미해결 {coverage.unresolved_new if coverage else 0}건 — 담당자 추가 확인 필요, 완전검토 아님)"
    )

    return {
        "exported_at": utc_now_iso(),
        "export_version": export_version_tag,
        "synthetic_notice": SYNTHETIC_NOTICE_KO if state.is_synthetic else USER_DOC_NOTICE_KO,
        "mode_notice": mode_banner,
        "completeness_notice": completeness_banner,
        "project": project,
        "old_docs": [d for d in old_docs if d],
        "new_docs": [d for d in new_docs if d],
        "old_clauses": old_clauses,
        "new_clauses": new_clauses,
        "old_cl_map": old_cl_map,
        "new_cl_map": new_cl_map,
        "alignments": alignments,
        "changes": changes,
        "checklist_items": checklist_items,
        "coverage": coverage,
        "latest_run": latest_run,
        "evidences_map": evidences_map,
    }


def export_to_json(bundle: Dict[str, Any]) -> bytes:
    payload = {
        "exported_at": bundle["exported_at"],
        "export_version": bundle["export_version"],
        "synthetic_notice": bundle["synthetic_notice"],
        "mode_notice": bundle["mode_notice"],
        "completeness_notice": bundle["completeness_notice"],
        "project": bundle["project"].to_dict(),
        "coverage": bundle["coverage"].to_dict() if bundle["coverage"] else None,
        "latest_run": bundle["latest_run"].to_dict() if bundle["latest_run"] else None,
        "old_documents": [d.to_dict() for d in bundle["old_docs"]],
        "new_documents": [d.to_dict() for d in bundle["new_docs"]],
        "clauses": {
            "old": [c.to_dict() for c in bundle["old_clauses"]],
            "new": [c.to_dict() for c in bundle["new_clauses"]],
        },
        "alignments": [a.to_dict() for a in bundle["alignments"]],
        "changes": [c.to_dict() for c in bundle["changes"]],
        "checklist_items": [i.to_dict() for i in bundle["checklist_items"]],
        "evidences": [e.to_dict() for e in bundle["evidences_map"].values()],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def export_to_xlsx(bundle: Dict[str, Any]) -> bytes:
    """XLSX 7개 시트(조항대조/수치변경/기한/체크리스트/미해결/근거/실행정보) 생성 ([H2-5], T12)."""
    wb = openpyxl.Workbook()
    # 기본 첫 시트를 '조항대조'로 설정
    ws_align = wb.active
    ws_align.title = "조항대조"
    ws_num = wb.create_sheet("수치변경")
    ws_date = wb.create_sheet("기한")
    ws_chk = wb.create_sheet("체크리스트")
    ws_unres = wb.create_sheet("미해결")
    ws_ev = wb.create_sheet("근거")
    ws_run = wb.create_sheet("실행정보")

    header_fill = PatternFill(start_color="1B365D", end_color="1B365D", fill_type="solid")
    banner_fill = PatternFill(start_color="E8EEF5", end_color="E8EEF5", fill_type="solid")
    alt_fill = PatternFill(start_color="F7FAFC", end_color="F7FAFC", fill_type="solid")
    header_font = Font(name="Malgun Gothic", size=10, bold=True, color="FFFFFF")
    banner_font = Font(name="Malgun Gothic", size=10, bold=True, color="1B365D")
    body_font = Font(name="Malgun Gothic", size=10, color="1A202C")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E0"),
        right=Side(style="thin", color="CBD5E0"),
        top=Side(style="thin", color="CBD5E0"),
        bottom=Side(style="thin", color="CBD5E0"),
    )

    def setup_sheet(ws, title_text: str, headers: List[str], rows: List[List[Any]]) -> None:
        ws.views.sheetView[0].showGridLines = True
        ncols = max(1, len(headers))
        last_col_letter = get_column_letter(ncols)
        ws.merge_cells(f"A1:{last_col_letter}1")
        ws["A1"] = sanitize_spreadsheet_cell(f"{title_text} — {bundle['synthetic_notice']}")
        ws["A1"].font = banner_font
        ws["A1"].fill = banner_fill
        ws.row_dimensions[1].height = 24

        ws.merge_cells(f"A2:{last_col_letter}2")
        ws["A2"] = sanitize_spreadsheet_cell(
            f"{bundle['mode_notice']} | {bundle['completeness_notice']} | 버전: {bundle['export_version']}"
        )
        ws["A2"].font = body_font
        ws.row_dimensions[2].height = 20

        for col_idx, h in enumerate(headers, start=1):
            c = ws.cell(row=3, column=col_idx, value=sanitize_spreadsheet_cell(h))
            c.fill = header_fill
            c.font = header_font
            c.border = thin_border
            c.alignment = XLAlignment(horizontal="center", vertical="center", wrap_text=True)
        ws.row_dimensions[3].height = 24
        ws.freeze_panes = "A4"

        for r_offset, row_vals in enumerate(rows, start=4):
            for c_idx, val in enumerate(row_vals, start=1):
                cell = ws.cell(row=r_offset, column=c_idx, value=sanitize_spreadsheet_cell(val))
                cell.font = body_font
                cell.border = thin_border
                if r_offset % 2 == 1:
                    cell.fill = alt_fill
                cell.alignment = XLAlignment(horizontal="left", vertical="top", wrap_text=True)

        # 열 너비 자동 조절 (병합된 1~2행 제외)
        for col_idx in range(1, ncols + 1):
            max_len = len(str(headers[col_idx - 1]))
            for r_idx in range(4, len(rows) + 4):
                v = str(ws.cell(row=r_idx, column=col_idx).value or "")
                first_line = v.splitlines()[0] if v else ""
                max_len = max(max_len, min(len(first_line), 45))
            col_letter = get_column_letter(col_idx)
            ws.column_dimensions[col_letter].width = min(max(max_len + 5, 14), 45)

    old_cl_map: Dict[str, Clause] = bundle["old_cl_map"]
    new_cl_map: Dict[str, Clause] = bundle["new_cl_map"]
    chg_by_aln: Dict[str, Change] = {c.alignment_id: c for c in bundle["changes"]}

    # 1. 조항대조 시트
    align_rows = []
    for al in bundle["alignments"]:
        ch = chg_by_aln.get(al.id)
        o_nums = ", ".join(old_cl_map[cid].clause_number or cid for cid in al.old_clause_ids if cid in old_cl_map) or "-"
        n_nums = ", ".join(new_cl_map[cid].clause_number or cid for cid in al.new_clause_ids if cid in new_cl_map) or "-"
        o_txt = "\n".join(old_cl_map[cid].text for cid in al.old_clause_ids if cid in old_cl_map) or "(구판 없음)"
        n_txt = "\n".join(new_cl_map[cid].text for cid in al.new_clause_ids if cid in new_cl_map) or "(신판 없음)"
        align_rows.append([
            al.id,
            o_nums,
            n_nums,
            al.relationship,
            ", ".join(al.flags) or "-",
            ", ".join(ch.categories) if ch else "-",
            ch.semantic_status if ch else "-",
            ch.summary_ko if ch else al.explanation,
            o_txt,
            n_txt,
            ch.review_status if ch else al.review_status,
            ", ".join((ch.evidence_old_ids + ch.evidence_new_ids) if ch else al.evidence_ids),
        ])
    setup_sheet(
        ws_align,
        f"[{bundle['project'].title}] 구판·신판 조항 변경대조표",
        [
            "정렬ID",
            "구판 조항번호",
            "신판 조항번호",
            "연결관계",
            "이동/분할/병합 플래그",
            "변경범주",
            "의미상태",
            "변경 요약(한국어)",
            "구판 원문",
            "신판 원문",
            "검토상태",
            "근거ID",
        ],
        align_rows,
    )

    # 2. 수치변경 시트
    num_rows = []
    for ch in bundle["changes"]:
        for nd in ch.numeric_deltas:
            of = nd.old_fact
            nf = nd.new_fact
            num_rows.append([
                ch.id,
                nd.subject,
                nd.quantity_kind,
                f"{of.raw_value} {of.raw_unit} ({of.operator_raw})" if of else "-",
                f"{of.canonical_decimal} {of.canonical_unit}" if (of and of.canonical_unit) else "미환산",
                f"{nf.raw_value} {nf.raw_unit} ({nf.operator_raw})" if nf else "-",
                f"{nf.canonical_decimal} {nf.canonical_unit}" if (nf and nf.canonical_unit) else "미환산",
                (of.conditions if of else "") or "기본조건",
                (nf.conditions if nf else "") or "기본조건",
                nd.status,
                "가능" if nd.calculable else "불가(검토필요)",
                nd.summary_ko,
                nd.reason_ko,
            ])
    setup_sheet(
        ws_num,
        f"[{bundle['project'].title}] 수치·단위·허용치 비교 상세",
        [
            "변경ID",
            "측정항목",
            "물리량",
            "구판 원문값(연산자)",
            "구판 표준환산",
            "신판 원문값(연산자)",
            "신판 표준환산",
            "구판 시험조건",
            "신판 시험조건",
            "판정상태",
            "자동계산가능",
            "비교 요약",
            "판정 근거/사유",
        ],
        num_rows,
    )

    # 3. 기한 시트
    date_rows = []
    for ch in bundle["changes"]:
        for dd in ch.date_deltas:
            date_rows.append([
                ch.id,
                dd.role,
                dd.old_date_raw or "-",
                dd.new_date_raw or "-",
                dd.resolved_date or "미확정",
                dd.status,
                "가능" if dd.calculable else "불가(미확정)",
                dd.basis_note_ko,
            ])
    setup_sheet(
        ws_date,
        f"[{bundle['project'].title}] 시행일·유예기간·적용기준일 분석",
        [
            "변경ID",
            "기한 역할(구분)",
            "구판 기한 원문",
            "신판 기한 원문",
            "확정 기한(ISO)",
            "확정 상태",
            "자동계산가능",
            "산정 기준 및 주의사항",
        ],
        date_rows,
    )

    # 4. 체크리스트 시트
    chk_rows = []
    for item in bundle["checklist_items"]:
        chk_rows.append([
            item.id,
            item.change_id,
            item.action_ko,
            item.applicable_condition,
            item.due_date or "미확정(확인필요)",
            item.due_date_status,
            item.priority_reason,
            item.verification_question,
            item.suggested_evidence_to_prepare,
            item.owner_placeholder,
            item.review_status,
            item.reviewer_note or "-",
        ])
    setup_sheet(
        ws_chk,
        f"[{bundle['project'].title}] 기업 대응 체크리스트 초안",
        [
            "체크리스트ID",
            "연결 변경ID",
            "대응 조치 항목(초안)",
            "적용 조건",
            "적용 기한",
            "기한 확정여부",
            "우선순위 사유",
            "담당자 확인 질문",
            "권장 준비 자료",
            "담당부서/담당자(공란)",
            "검토상태",
            "검토메모",
        ],
        chk_rows,
    )

    # 5. 미해결 시트
    unres_rows = []
    for al in bundle["alignments"]:
        ch = chg_by_aln.get(al.id)
        if al.relationship in ("unmatched_old", "unmatched_new") or (ch and ch.semantic_status in ("addition_candidate", "deletion_candidate", "unresolved")) or (ch and ch.uncertainties):
            o_nums = ", ".join(old_cl_map[cid].clause_number or cid for cid in al.old_clause_ids if cid in old_cl_map) or "-"
            n_nums = ", ".join(new_cl_map[cid].clause_number or cid for cid in al.new_clause_ids if cid in new_cl_map) or "-"
            unres_rows.append([
                al.id,
                ch.id if ch else "-",
                o_nums,
                n_nums,
                al.relationship,
                ch.semantic_status if ch else "unresolved",
                ch.summary_ko if ch else al.explanation,
                " / ".join(ch.uncertainties) if (ch and ch.uncertainties) else "담당자 원문 대조 확인 필요",
                ch.review_status if ch else al.review_status,
            ])
    setup_sheet(
        ws_unres,
        f"[{bundle['project'].title}] 미해결 조항(신설·삭제 후보) 및 조건부 검토 항목",
        [
            "정렬ID",
            "변경ID",
            "구판 조항번호",
            "신판 조항번호",
            "연결상태",
            "의미상태",
            "내용 요약",
            "미확정/검토필요 사유",
            "검토상태",
        ],
        unres_rows,
    )

    # 6. 근거 시트
    ev_rows = []
    for ev in bundle["evidences_map"].values():
        ev_rows.append([
            ev.id,
            ev.document_id,
            ev.segment_id,
            ev.locator or "-",
            f"{ev.raw_start}..{ev.raw_end}",
            ev.verification_status,
            ev.quote,
            ev.reason,
        ])
    setup_sheet(
        ws_ev,
        f"[{bundle['project'].title}] 원문 근거(Evidence) 검증 부록",
        [
            "근거ID",
            "문서ID",
            "세그먼트ID",
            "원문 위치(Locator)",
            "원문 오프셋(raw_start..end)",
            "검증상태",
            "원문 인용구(Quote)",
            "검증 사유",
        ],
        ev_rows,
    )

    # 7. 실행정보 시트
    cov: Optional[Coverage] = bundle["coverage"]
    run: Optional[AnalysisRun] = bundle["latest_run"]
    proj: ComparisonProject = bundle["project"]
    run_rows = [
        ["프로젝트 ID", proj.id],
        ["프로젝트 제목", proj.title],
        ["대상 국가 / 제품군", f"{proj.country} / {proj.product_scope}"],
        ["구판 판본 / 신판 판본", f"{proj.old_version} → {proj.new_version}"],
        ["기준일(Target Date)", proj.target_date],
        ["내보내기 시각 / 버전", f"{bundle['exported_at']} / {bundle['export_version']}"],
        ["가상 규정 고지", bundle["synthetic_notice"]],
        ["실행 모드 고지", bundle["mode_notice"]],
        ["완전성/미해결 상태", bundle["completeness_notice"]],
        ["공급자 / 모델명", f"{run.provider if run else 'fixture'} / {run.model_name if run else 'fixture-v1'}"],
        ["프롬프트 / 스키마 버전", f"{run.prompt_version if run else 'v1.0'} / {run.schema_version if run else 'v1'}"],
        ["구판 조항 커버리지", f"{cov.accounted_old}/{cov.total_old_clauses} (미해결 {cov.unresolved_old}, 중복 {cov.duplicate_old})" if cov else "-"],
        ["신판 조항 커버리지", f"{cov.accounted_new}/{cov.total_new_clauses} (미해결 {cov.unresolved_new}, 중복 {cov.duplicate_new})" if cov else "-"],
    ]
    setup_sheet(
        ws_run,
        f"[{bundle['project'].title}] 분석 실행 및 재현성 메타데이터",
        ["항목", "값"],
        run_rows,
    )

    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def export_to_markdown(bundle: Dict[str, Any]) -> bytes:
    proj: ComparisonProject = bundle["project"]
    cov: Optional[Coverage] = bundle["coverage"]
    old_cl_map: Dict[str, Clause] = bundle["old_cl_map"]
    new_cl_map: Dict[str, Clause] = bundle["new_cl_map"]
    chg_by_aln: Dict[str, Change] = {c.alignment_id: c for c in bundle["changes"]}

    lines: List[str] = [
        f"# {proj.title} — 해외규제 구판·신판 변경대조 및 대응 체크리스트 보고서",
        "",
        f"> {bundle['synthetic_notice']}",
        f"> {bundle['mode_notice']}",
        f"> {bundle['completeness_notice']} (내보내기 버전: `{bundle['export_version']}`)",
        "",
        "## 1. 분석 개요 및 조항 커버리지 요약",
        "",
        "| 항목 | 내용 |",
        "| :--- | :--- |",
        f"| 대상 국가 / 제품군 | {proj.country} / {proj.product_scope} |",
        f"| 비교 판본 | 구판 `{proj.old_version}` → 신판 `{proj.new_version}` |",
        f"| 기준일 | {proj.target_date} |",
        f"| 구판 조항 수 / 반영 수 | {cov.total_old_clauses if cov else 0}개 중 {cov.accounted_old if cov else 0}개 반영 (미해결 후보 {cov.unresolved_old if cov else 0}개) |",
        f"| 신판 조항 수 / 반영 수 | {cov.total_new_clauses if cov else 0}개 중 {cov.accounted_new if cov else 0}개 반영 (미해결 후보 {cov.unresolved_new if cov else 0}개) |",
        "",
        "## 2. 조항별 변경대조표",
        "",
        "| 구판 조항 | 신판 조항 | 연결관계 | 변경범주 | 의미상태 | 변경 요약 | 검토상태 | 근거ID |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]

    for al in bundle["alignments"]:
        ch = chg_by_aln.get(al.id)
        o_nums = ", ".join(old_cl_map[cid].clause_number or cid for cid in al.old_clause_ids if cid in old_cl_map) or "-"
        n_nums = ", ".join(new_cl_map[cid].clause_number or cid for cid in al.new_clause_ids if cid in new_cl_map) or "-"
        cats = ", ".join(ch.categories) if ch else "-"
        sem = ch.semantic_status if ch else "-"
        summ = (ch.summary_ko if ch else al.explanation).replace("|", "/")
        rev = ch.review_status if ch else al.review_status
        evs = ", ".join((ch.evidence_old_ids + ch.evidence_new_ids) if ch else al.evidence_ids)
        lines.append(f"| {o_nums} | {n_nums} | {al.relationship} | {cats} | {sem} | {summ} | {rev} | {evs} |")

    lines.extend([
        "",
        "## 3. 수치·단위·기한 주요 변경 내역",
        "",
        "| 변경ID | 구분 | 구판 기준 | 신판 기준 | 판정 상태 | 요약 및 검토 사유 |",
        "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ])
    for ch in bundle["changes"]:
        for nd in ch.numeric_deltas:
            of = nd.old_fact
            nf = nd.new_fact
            o_s = f"{of.raw_value}{of.raw_unit} ({of.operator_raw})" if of else "-"
            n_s = f"{nf.raw_value}{nf.raw_unit} ({nf.operator_raw})" if nf else "-"
            lines.append(f"| {ch.id} | 수치({nd.quantity_kind}) | {o_s} | {n_s} | {nd.status} | {nd.summary_ko} |")
        for dd in ch.date_deltas:
            lines.append(f"| {ch.id} | 기한({dd.role}) | {dd.old_date_raw or '-'} | {dd.new_date_raw or '-'} | {dd.status} | {dd.basis_note_ko} |")

    lines.extend([
        "",
        "## 4. 기업 대응 체크리스트 초안",
        "",
        "| ID | 변경ID | 대응 조치(초안) | 적용 기한 | 기한 상태 | 확인 질문 | 준비 자료 | 검토상태 |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ])
    for item in bundle["checklist_items"]:
        lines.append(
            f"| {item.id} | {item.change_id} | {item.action_ko} | {item.due_date or '미확정'} | {item.due_date_status} | {item.verification_question} | {item.suggested_evidence_to_prepare} | {item.review_status} |"
        )

    lines.extend([
        "",
        "## 5. 부록: 원문 근거(Evidence) 검증 목록",
        "",
        "| 근거ID | 위치(Locator) | 오프셋 | 검증상태 | 원문 인용구(Quote) |",
        "| :--- | :--- | :--- | :--- | :--- |",
    ])
    for ev in bundle["evidences_map"].values():
        q_clean = ev.quote.replace("\n", " ").replace("|", "/")
        lines.append(f"| {ev.id} | {ev.locator or '-'} | {ev.raw_start}..{ev.raw_end} | {ev.verification_status} | {q_clean} |")

    return "\n".join(lines).encode("utf-8")


def export_to_docx(bundle: Dict[str, Any]) -> bytes:
    """word-processing 지침(1인치 여백, 본문 11pt, 표 10pt 이상, 헤더 반복, 행 분할 방지)을 준수한 DOCX 생성 ([H2-5], T12)."""
    doc = docx.Document()
    for section in doc.sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)

    style_normal = doc.styles["Normal"]
    style_normal.font.name = "Malgun Gothic"
    style_normal.font.size = Pt(11)
    style_normal.font.color.rgb = RGBColor(0x1A, 0x20, 0x2C)

    proj: ComparisonProject = bundle["project"]
    cov: Optional[Coverage] = bundle["coverage"]
    old_cl_map: Dict[str, Clause] = bundle["old_cl_map"]
    new_cl_map: Dict[str, Clause] = bundle["new_cl_map"]
    chg_by_aln: Dict[str, Change] = {c.alignment_id: c for c in bundle["changes"]}

    title_p = doc.add_paragraph()
    title_run = title_p.add_run(f"{proj.title} — 해외규제 변경대조 및 대응체크리스트 보고서")
    title_run.font.size = Pt(18)
    title_run.font.bold = True
    title_run.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)
    title_p.paragraph_format.space_after = Pt(8)

    for notice in (bundle["synthetic_notice"], bundle["mode_notice"], bundle["completeness_notice"]):
        np = doc.add_paragraph()
        nr = np.add_run(notice)
        nr.font.size = Pt(11)
        nr.font.bold = True
        np.paragraph_format.space_after = Pt(4)

    def add_heading_1(text: str) -> None:
        hp = doc.add_paragraph()
        hr = hp.add_run(text)
        hr.font.size = Pt(14)
        hr.font.bold = True
        hr.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D)
        hp.paragraph_format.space_before = Pt(14)
        hp.paragraph_format.space_after = Pt(6)
        hp.paragraph_format.keep_with_next = True

    def add_styled_table(headers: List[str], rows_data: List[List[str]]) -> None:
        table = doc.add_table(rows=1, cols=len(headers))
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        hdr_row = table.rows[0]
        hdr_tr = hdr_row._tr.get_or_add_trPr()
        hdr_tr.append(parse_xml(r'<w:tblHeader {}/>'.format(nsdecls("w"))))

        for idx, h_text in enumerate(headers):
            cell = hdr_row.cells[idx]
            cell.text = h_text
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            shd = parse_xml(r'<w:shd {} w:fill="1B365D"/>'.format(nsdecls("w")))
            cell._tc.get_or_add_tcPr().append(shd)
            for p in cell.paragraphs:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.keep_with_next = True
                for r in p.runs:
                    r.font.bold = True
                    r.font.size = Pt(10.5)
                    r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

        for r_idx, r_vals in enumerate(rows_data):
            row = table.add_row()
            trPr = row._tr.get_or_add_trPr()
            trPr.append(parse_xml(r'<w:cantSplit {}/>'.format(nsdecls("w"))))
            for c_idx, val in enumerate(r_vals):
                cell = row.cells[c_idx]
                cell.text = str(val or "-")
                cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
                if r_idx % 2 == 1:
                    shd = parse_xml(r'<w:shd {} w:fill="F2F6FA"/>'.format(nsdecls("w")))
                    cell._tc.get_or_add_tcPr().append(shd)
                for p in cell.paragraphs:
                    p.paragraph_format.space_before = Pt(2)
                    p.paragraph_format.space_after = Pt(2)
                    for r in p.runs:
                        r.font.size = Pt(10)

    add_heading_1("1. 비교 프로젝트 개요 및 커버리지 요약")
    summary_rows = [
        ["대상 국가 / 제품군", f"{proj.country} / {proj.product_scope}"],
        ["구판 / 신판 판본", f"{proj.old_version} → {proj.new_version}"],
        ["기준일 / 내보내기 버전", f"{proj.target_date} / {bundle['export_version']}"],
        [
            "조항 커버리지",
            f"구판 {cov.accounted_old if cov else 0}/{cov.total_old_clauses if cov else 0}조항, 신판 {cov.accounted_new if cov else 0}/{cov.total_new_clauses if cov else 0}조항 (미해결: 구판 {cov.unresolved_old if cov else 0}, 신판 {cov.unresolved_new if cov else 0})",
        ],
    ]
    add_styled_table(["항목", "내용"], summary_rows)

    add_heading_1("2. 조항별 구판·신판 변경대조표")
    diff_rows = []
    for al in bundle["alignments"]:
        ch = chg_by_aln.get(al.id)
        o_nums = ", ".join(old_cl_map[cid].clause_number or cid for cid in al.old_clause_ids if cid in old_cl_map) or "-"
        n_nums = ", ".join(new_cl_map[cid].clause_number or cid for cid in al.new_clause_ids if cid in new_cl_map) or "-"
        diff_rows.append([
            f"{o_nums} → {n_nums}\n({al.relationship})",
            ", ".join(ch.categories) if ch else "-",
            ch.semantic_status if ch else "-",
            ch.summary_ko if ch else al.explanation,
            ch.review_status if ch else al.review_status,
        ])
    add_styled_table(["구판→신판 조항", "변경범주", "의미상태", "변경 요약", "검토상태"], diff_rows)

    add_heading_1("3. 기업 대응 체크리스트 초안")
    chk_rows = []
    for item in bundle["checklist_items"]:
        chk_rows.append([
            item.id,
            item.action_ko,
            f"{item.due_date or '미확정'} ({item.due_date_status})",
            item.verification_question,
            item.review_status,
        ])
    add_styled_table(["ID", "대응 조치 항목(초안)", "적용 기한(상태)", "담당자 확인 질문", "검토상태"], chk_rows)

    add_heading_1("4. 부록: 원문 근거(Evidence) 검증 내역")
    ev_rows = []
    for ev in bundle["evidences_map"].values():
        ev_rows.append([
            ev.id,
            ev.locator or "-",
            ev.verification_status,
            ev.quote[:140],
        ])
    add_styled_table(["근거ID", "원문 위치", "검증상태", "원문 인용구"], ev_rows)

    bio = io.BytesIO()
    doc.save(bio)
    return bio.getvalue()


def export_to_html(bundle: Dict[str, Any]) -> bytes:
    """인쇄용(브라우저 PDF 인쇄 지원) 한국어 HTML 보고서 생성 ([F], [H2-5])."""
    proj: ComparisonProject = bundle["project"]
    cov: Optional[Coverage] = bundle["coverage"]
    old_cl_map: Dict[str, Clause] = bundle["old_cl_map"]
    new_cl_map: Dict[str, Clause] = bundle["new_cl_map"]
    chg_by_aln: Dict[str, Change] = {c.alignment_id: c for c in bundle["changes"]}

    esc = html.escape

    diff_trs = []
    for al in bundle["alignments"]:
        ch = chg_by_aln.get(al.id)
        o_nums = ", ".join(old_cl_map[cid].clause_number or cid for cid in al.old_clause_ids if cid in old_cl_map) or "-"
        n_nums = ", ".join(new_cl_map[cid].clause_number or cid for cid in al.new_clause_ids if cid in new_cl_map) or "-"
        diff_trs.append(
            f"<tr>"
            f"<td><strong>{esc(o_nums)} → {esc(n_nums)}</strong><br><small>{esc(al.relationship)}</small></td>"
            f"<td>{esc(', '.join(ch.categories) if ch else '-')}</td>"
            f"<td>{esc(ch.semantic_status if ch else '-')}</td>"
            f"<td>{esc(ch.summary_ko if ch else al.explanation)}</td>"
            f"<td>{esc(ch.review_status if ch else al.review_status)}</td>"
            f"<td>{esc(', '.join((ch.evidence_old_ids + ch.evidence_new_ids) if ch else al.evidence_ids))}</td>"
            f"</tr>"
        )

    chk_trs = []
    for item in bundle["checklist_items"]:
        chk_trs.append(
            f"<tr>"
            f"<td>{esc(item.id)}</td>"
            f"<td>{esc(item.change_id)}</td>"
            f"<td>{esc(item.action_ko)}</td>"
            f"<td>{esc(item.due_date or '미확정')} ({esc(item.due_date_status)})</td>"
            f"<td>{esc(item.verification_question)}</td>"
            f"<td>{esc(item.suggested_evidence_to_prepare)}</td>"
            f"<td>{esc(item.review_status)}</td>"
            f"</tr>"
        )

    ev_trs = []
    for ev in bundle["evidences_map"].values():
        ev_trs.append(
            f"<tr>"
            f"<td>{esc(ev.id)}</td>"
            f"<td>{esc(ev.locator or '-')}</td>"
            f"<td>{ev.raw_start}..{ev.raw_end}</td>"
            f"<td>{esc(ev.verification_status)}</td>"
            f"<td>{esc(ev.quote)}</td>"
            f"</tr>"
        )

    html_doc = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>{esc(proj.title)} — 인쇄용 변경대조 보고서</title>
<style>
  body {{ font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; color: #1a202c; margin: 24px; line-height: 1.5; }}
  h1 {{ color: #1b365d; font-size: 20px; border-bottom: 2px solid #1b365d; padding-bottom: 8px; }}
  h2 {{ color: #1b365d; font-size: 15px; margin-top: 22px; }}
  .notice-box {{ background: #edf2f7; border-left: 4px solid #1b365d; padding: 10px 14px; margin-bottom: 14px; font-size: 13px; }}
  .print-bar {{ margin-bottom: 16px; }}
  .btn-print {{ background: #1b365d; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }}
  th {{ background: #1b365d; color: #fff; padding: 8px; text-align: left; border: 1px solid #cbd5e0; }}
  td {{ padding: 7px 8px; border: 1px solid #cbd5e0; vertical-align: top; word-break: keep-all; }}
  tr:nth-child(even) td {{ background: #f8fafc; }}
  @media print {{
    .print-bar {{ display: none; }}
    body {{ margin: 10mm; }}
  }}
</style>
</head>
<body>
  <div class="print-bar">
    <button class="btn-print" onclick="window.print()">🖨️ 브라우저 PDF 인쇄 / 저장</button>
  </div>
  <h1>{esc(proj.title)} — 해외규제 변경대조 및 대응 체크리스트</h1>
  <div class="notice-box">
    <div><strong>{esc(bundle['synthetic_notice'])}</strong></div>
    <div>{esc(bundle['mode_notice'])} | {esc(bundle['completeness_notice'])} | 버전: {esc(bundle['export_version'])}</div>
    <div>국가/제품군: {esc(proj.country)} / {esc(proj.product_scope)} | 판본: {esc(proj.old_version)} → {esc(proj.new_version)} | 기준일: {esc(proj.target_date)}</div>
  </div>

  <h2>1. 조항별 변경대조표 (총 {len(bundle['alignments'])}건)</h2>
  <table>
    <thead>
      <tr><th>구판→신판 조항</th><th>변경범주</th><th>의미상태</th><th>변경 요약</th><th>검토상태</th><th>근거ID</th></tr>
    </thead>
    <tbody>
      {''.join(diff_trs)}
    </tbody>
  </table>

  <h2>2. 기업 대응 체크리스트 초안 (총 {len(bundle['checklist_items'])}건)</h2>
  <table>
    <thead>
      <tr><th>ID</th><th>변경ID</th><th>대응 조치(초안)</th><th>적용 기한</th><th>확인 질문</th><th>준비 자료</th><th>검토상태</th></tr>
    </thead>
    <tbody>
      {''.join(chk_trs)}
    </tbody>
  </table>

  <h2>3. 부록: 원문 근거(Evidence) 검증 목록</h2>
  <table>
    <thead>
      <tr><th>근거ID</th><th>위치(Locator)</th><th>오프셋</th><th>검증상태</th><th>원문 인용구(Quote)</th></tr>
    </thead>
    <tbody>
      {''.join(ev_trs)}
    </tbody>
  </table>
</body>
</html>"""
    return html_doc.encode("utf-8")


def export_project_artifact(state: Any, fmt: str) -> Tuple[bytes, str, str]:
    """요청된 포맷(json|xlsx|md|docx|html)으로 내보내기 바이트, media_type, 파일명을 반환한다."""
    fmt_clean = fmt.strip().lower()
    bundle = gather_export_bundle(state)
    ver_tag = bundle["export_version"]
    safe_proj = re.sub(r"[^0-9A-Za-z가-힣_\-]", "_", bundle["project"].id)

    if fmt_clean == "json":
        data = export_to_json(bundle)
        fname = f"kats_diff_{safe_proj}_{ver_tag}.json"
        mtype = "application/json"
    elif fmt_clean == "xlsx":
        data = export_to_xlsx(bundle)
        fname = f"kats_diff_{safe_proj}_{ver_tag}.xlsx"
        mtype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif fmt_clean == "md":
        data = export_to_markdown(bundle)
        fname = f"kats_diff_{safe_proj}_{ver_tag}.md"
        mtype = "text/markdown; charset=utf-8"
    elif fmt_clean == "docx":
        data = export_to_docx(bundle)
        fname = f"kats_diff_{safe_proj}_{ver_tag}.docx"
        mtype = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif fmt_clean == "html":
        data = export_to_html(bundle)
        fname = f"kats_diff_{safe_proj}_{ver_tag}.html"
        mtype = "text/html; charset=utf-8"
    else:
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko=f"지원하지 않는 내보내기 형식({fmt})입니다. 지원 형식: json, xlsx, md, docx, html.",
            status_code=400,
        )

    return data, mtype, fname
