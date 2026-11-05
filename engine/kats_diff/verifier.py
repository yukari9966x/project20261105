"""원문 근거(Evidence) 오프셋 및 무결성 검증 모듈 ([C])."""
from __future__ import annotations

import uuid
from typing import Dict, List, Optional

from .schemas import Document, Evidence, Segment
from .parser import normalize_with_map


def create_and_verify_evidence(
    doc: Document,
    segments_by_id: Dict[str, Segment],
    segment_id: str,
    quote: str,
    evidence_id: Optional[str] = None,
) -> Evidence:
    """AI 또는 분석기가 반환한 segment_id와 quote를 실제 원문(raw_text)에서 찾아 오프셋과 해시를 검증한다.

    - 문서 해시·segment 소유관계·offsets·원문 일치를 검증한다.
    - 정규화 매칭이면 normalization_map을 통해 원문 위치로 역매핑한다.
    - 유사 문자열(퍼지 매칭)만으로는 절대 검증 성공(valid) 처리하지 않는다 ([C]).
    """
    ev_id = evidence_id or f"ev-{uuid.uuid4().hex[:10]}"
    clean_quote = (quote or "").strip()

    if not clean_quote:
        return Evidence(
            id=ev_id,
            document_id=doc.id,
            segment_id=segment_id or "missing",
            raw_start=-1,
            raw_end=-1,
            quote="",
            verification_status="missing",
            reason="인용 문구(quote)가 비어 있습니다.",
            locator=None,
        )

    seg = segments_by_id.get(segment_id)
    if seg is None:
        return Evidence(
            id=ev_id,
            document_id=doc.id,
            segment_id=segment_id or "unknown",
            raw_start=-1,
            raw_end=-1,
            quote=clean_quote,
            verification_status="invalid",
            reason=f"존재하지 않는 Segment ID({segment_id})입니다.",
            locator=None,
        )

    if seg.document_id != doc.id:
        return Evidence(
            id=ev_id,
            document_id=doc.id,
            segment_id=segment_id,
            raw_start=-1,
            raw_end=-1,
            quote=clean_quote,
            verification_status="invalid",
            reason=f"Segment({segment_id})가 대상 문서({doc.id})에 속하지 않습니다.",
            locator=seg.locator,
        )

    if seg.document_sha256 != doc.sha256:
        return Evidence(
            id=ev_id,
            document_id=doc.id,
            segment_id=segment_id,
            raw_start=-1,
            raw_end=-1,
            quote=clean_quote,
            verification_status="invalid",
            reason="문서 SHA-256 해시가 Segment 생성 시점의 해시와 일치하지 않습니다.",
            locator=seg.locator,
        )

    # 1차: raw_text에서 직접 일치 검색
    direct_idx = seg.raw_text.find(clean_quote)
    if direct_idx != -1:
        raw_start = direct_idx
        raw_end = direct_idx + len(clean_quote)
        exact_slice = seg.raw_text[raw_start:raw_end]
        return Evidence(
            id=ev_id,
            document_id=doc.id,
            segment_id=seg.id,
            raw_start=raw_start,
            raw_end=raw_end,
            quote=exact_slice,
            verification_status="valid",
            reason="원문(raw_text) 직접 일치 검증 완료",
            locator=seg.locator,
        )

    # 2차: 공백/줄바꿈 정규화 텍스트에서 일치 검색 후 normalization_map으로 원문 오프셋 역매핑
    norm_quote, _ = normalize_with_map(clean_quote)
    norm_seg, norm_map = normalize_with_map(seg.raw_text)

    if norm_quote and norm_map:
        norm_idx = norm_seg.find(norm_quote)
        if norm_idx != -1:
            norm_end_idx = norm_idx + len(norm_quote) - 1
            if 0 <= norm_idx < len(norm_map) and 0 <= norm_end_idx < len(norm_map):
                raw_start = norm_map[norm_idx]
                raw_end = norm_map[norm_end_idx] + 1
                mapped_slice = seg.raw_text[raw_start:raw_end]
                mapped_norm, _ = normalize_with_map(mapped_slice)
                if mapped_norm == norm_quote:
                    return Evidence(
                        id=ev_id,
                        document_id=doc.id,
                        segment_id=seg.id,
                        raw_start=raw_start,
                        raw_end=raw_end,
                        quote=mapped_slice,
                        verification_status="valid",
                        reason="정규화 매칭 후 원문 오프셋 역매핑 검증 완료",
                        locator=seg.locator,
                    )

    return Evidence(
        id=ev_id,
        document_id=doc.id,
        segment_id=seg.id,
        raw_start=-1,
        raw_end=-1,
        quote=clean_quote,
        verification_status="invalid",
        reason="제시된 인용 문구가 해당 Segment 원문과 일치하지 않습니다.",
        locator=seg.locator,
    )
