"""조항 분할기(ClauseSegmenter) 도메인 모듈 ([H2-3])."""
from __future__ import annotations

import hashlib
import re
from typing import Dict, List, Optional

from .patterns import CLAUSE_HEADER_RE, HEADING_ONLY_RE, LIST_ITEM_RE
from .schemas import Clause, Segment
from .parser import normalize_with_map

# 번호 없는 문단을 이어 붙인 임시 조항(P-n)이 지나치게 커지지 않도록 하는 상한(문자 수)
PSEUDO_CLAUSE_MAX_CHARS = 1500

DOC_BANNER_RE = re.compile(
    r"^(?:\[가상\s*규정[^\]]*\]|가상\s*규정\s*[:\-—]|\[SYNTHETIC\s+REGULATION[^\]]*\]|SYNTHETIC\s+REGULATION|고시번호\s*[:：]|개정일\s*[:：]|문서버전\s*[:：])",
    re.IGNORECASE,
)

FOOTNOTE_RE = re.compile(r"^(?:\*+|주\s*\d*[:.)]|각주\s*\d*[:.)]|Note\s*\d*[:.)])", re.IGNORECASE)


def _canonical_clause_num(raw_num: str) -> str:
    s = re.sub(r"\s+", "", raw_num)
    s = re.sub(r"^(?:Clause|Article|Section|Artículo|Articulo|Artigo|Artikel|Art\.)", "", s, flags=re.IGNORECASE)
    return s.rstrip(".")  # "3.2." 와 "3.2" 를 같은 번호로 취급


def strip_clause_prefix(text: str) -> str:
    """조항 번호 접두어만 제거한 본문(제목+내용)을 반환한다 (번호 이동 조항 비교용)."""
    m = CLAUSE_HEADER_RE.match(text.strip())
    if not m:
        return text.strip()
    rest = text.strip()[m.end():].strip()
    title = (m.group("paren_title") or m.group("dash_title") or m.group("inline_title") or "").strip()
    if title and rest:
        return f"{title}\n{rest}"
    if title:
        return title
    return rest or text.strip()


def segment_clauses(
    document_id: str,
    version_side: str,
    segments: List[Segment],
) -> List[Clause]:
    """Segment 목록을 받아 번호·제목·본문·표·각주를 보존한 Clause 목록으로 분할한다 ([H2-3.1])."""
    clauses: List[Clause] = []
    current_heading = ""
    seq_no = 0

    active_clause_data: Optional[Dict] = None

    def flush_active() -> None:
        nonlocal active_clause_data, seq_no
        if not active_clause_data:
            return
        full_text = "\n".join(active_clause_data["texts"]).strip()
        norm_text, _ = normalize_with_map(full_text)
        content_hash = hashlib.sha256(norm_text.encode("utf-8")).hexdigest()
        seq_no += 1
        c_num = active_clause_data["clause_number"]
        clauses.append(
            Clause(
                id=f"cl-{document_id}-{version_side}-{seq_no:03d}",
                document_id=document_id,
                version_side=version_side,
                heading_path=active_clause_data["heading_path"],
                clause_number=c_num,
                segment_ids=list(active_clause_data["segment_ids"]),
                text=full_text,
                normalized_text=norm_text,
                table_cells=list(active_clause_data["table_cells"]),
                footnotes=list(active_clause_data["footnotes"]),
                sequence_no=seq_no,
                content_hash=content_hash,
                locator=active_clause_data["locator"],
            )
        )
        active_clause_data = None

    def is_numbered(data: Optional[Dict]) -> bool:
        num = (data or {}).get("clause_number") or ""
        return bool(num) and not num.startswith("P-") and not num.startswith("TABLE-")

    def attach(data: Dict, seg: Segment, text: str, footnote: bool = False) -> None:
        if seg.id not in data["segment_ids"]:
            data["segment_ids"].append(seg.id)
        data["texts"].append(text)
        if footnote:
            data["footnotes"].append(text)

    def start_pseudo(seg: Segment, text: str) -> None:
        nonlocal active_clause_data
        flush_active()
        active_clause_data = {
            "heading_path": current_heading or seg.heading_path,
            "clause_number": f"P-{seq_no + 1}",
            "segment_ids": [seg.id],
            "texts": [text],
            "table_cells": [],
            "footnotes": [],
            "locator": seg.locator,
        }

    for seg in segments:
        raw = seg.raw_text.strip()
        if not raw:
            continue

        first_line = raw.splitlines()[0].strip()
        if len(raw.splitlines()) == 1 and (
            HEADING_ONLY_RE.match(first_line)
            or first_line.startswith("# ")
            or first_line.startswith("## ")
            or DOC_BANNER_RE.match(first_line)
        ):
            if not DOC_BANNER_RE.match(first_line):
                # 장·절·부칙·부속서 제목은 조항 묶음의 경계 → 앞 조항을 닫는다
                flush_active()
                current_heading = re.sub(r"^#+\s*", "", first_line).strip()
            continue

        if seg.table_location is not None:
            cell_entry = {
                "segment_id": seg.id,
                "locator": seg.locator,
                "table_index": seg.table_location.table_index,
                "row_index": seg.table_location.row_index,
                "col_index": seg.table_location.col_index,
                "row_header": seg.table_location.row_header,
                "col_header": seg.table_location.col_header,
                "text": raw,
            }
            if active_clause_data is not None:
                attach(active_clause_data, seg, raw)
                active_clause_data["table_cells"].append(cell_entry)
                continue
            else:
                active_clause_data = {
                    "heading_path": seg.heading_path or current_heading,
                    "clause_number": f"TABLE-{seg.table_location.table_index}",
                    "segment_ids": [seg.id],
                    "texts": [raw],
                    "table_cells": [cell_entry],
                    "footnotes": [],
                    "locator": seg.locator,
                }
                continue

        if FOOTNOTE_RE.match(raw) and active_clause_data is not None:
            attach(active_clause_data, seg, raw, footnote=True)
            continue

        lines = raw.splitlines()
        sub_blocks: List[List[str]] = []
        cur_lines: List[str] = []
        for line in lines:
            s_line = line.strip()
            if HEADING_ONLY_RE.match(s_line):
                if cur_lines:
                    sub_blocks.append(cur_lines)
                    cur_lines = []
                sub_blocks.append(["\x00HEADING", s_line])
                continue
            if CLAUSE_HEADER_RE.match(s_line) and cur_lines:
                sub_blocks.append(cur_lines)
                cur_lines = [line]
            else:
                cur_lines.append(line)
        if cur_lines:
            sub_blocks.append(cur_lines)

        for blk in sub_blocks:
            if blk and blk[0] == "\x00HEADING":
                flush_active()
                current_heading = re.sub(r"^#+\s*", "", blk[1]).strip()
                continue
            blk_text = "\n".join(blk).strip()
            if not blk_text:
                continue
            if DOC_BANNER_RE.match(blk_text) and len(blk) <= 2:
                continue

            m = CLAUSE_HEADER_RE.match(blk_text)
            if m:
                flush_active()
                c_num = _canonical_clause_num(m.group("num"))
                active_clause_data = {
                    "heading_path": current_heading or seg.heading_path,
                    "clause_number": c_num,
                    "segment_ids": [seg.id],
                    "texts": [blk_text],
                    "table_cells": [],
                    "footnotes": [],
                    "locator": seg.locator,
                }
                continue

            if active_clause_data is not None and FOOTNOTE_RE.match(blk_text):
                attach(active_clause_data, seg, blk_text, footnote=True)
            elif is_numbered(active_clause_data):
                # 항(①)·호(1.)·목(가.) 및 줄바꿈으로 이어진 문장은 직전 조항의 일부다
                attach(active_clause_data, seg, blk_text)
            elif (
                active_clause_data is not None
                and not LIST_ITEM_RE.match(blk_text)
                and sum(len(t) for t in active_clause_data["texts"]) < PSEUDO_CLAUSE_MAX_CHARS
            ):
                # 번호 없는 문단 묶음(P-n): 이어지는 문장은 붙이고, 새 항목 기호가 나오면 새 묶음
                attach(active_clause_data, seg, blk_text)
            else:
                start_pseudo(seg, blk_text)

    flush_active()
    return clauses
