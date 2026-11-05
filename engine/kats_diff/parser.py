"""문서 업로드 보안 검사 및 포맷별(TXT/MD, PDF, DOCX, HWPX) 파서 모듈 ([C]).

브라우저(Pyodide) 이식판: 원본 `app/services/ingest/parser.py` 에서 서버 설정(app.config)·OCR·디스크 저장을 걷어냈다.
파일은 브라우저 메모리에서만 다루며 어디에도 저장·전송하지 않는다.
"""
from __future__ import annotations

import hashlib
import io
import re
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from defusedxml import ElementTree as SafeET
import docx
from pypdf import PdfReader

from .patterns import (
    CLAUSE_HEADER_RE,
    HEADING_ONLY_RE,
    HEADING_PREFIX_RE,
    LIST_ITEM_RE,
    PAGE_NOISE_RE,
)
from .schemas import AppException, Document, Segment, TableLocation, utc_now_iso

PARSER_VERSION = "1.1.0-pyodide"


@dataclass
class Settings:
    """원본 app.config.Settings 중 파서가 쓰는 상한값만 남긴 것 (기본값 동일)."""

    max_upload_bytes: int = 25 * 1024 * 1024  # 25MB
    max_pair_pages: int = 150
    max_zip_entries: int = 500
    max_zip_uncompressed_bytes: int = 80 * 1024 * 1024
    max_zip_compression_ratio: float = 50.0


def get_settings() -> Settings:
    return Settings()

OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
PDF_MAGIC = b"%PDF-"
ZIP_MAGIC = b"PK\x03\x04"

_COMPAT_SPACE_MAP = {
    "\u00a0": " ",
    "\u3000": " ",
    "\t": " ",
    "\r": "\n",
}


def normalize_with_map(raw_text: str) -> Tuple[str, List[int]]:
    """원문 텍스트의 연속 공백·줄바꿈만 정리하고 정규화 문자 인덱스 → 원문 오프셋 역매핑 배열을 반환한다.

    숫자, 소수점, 부등호, 부정어, 날짜, 단위, 표준번호는 절대 지우거나 변경하지 않는다 ([H2-3.2]).
    """
    norm_chars: List[str] = []
    norm_to_raw: List[int] = []
    prev_space = True

    for idx, ch in enumerate(raw_text):
        mapped = _COMPAT_SPACE_MAP.get(ch, ch)
        if mapped in (" ", "\n"):
            if not prev_space:
                norm_chars.append(" ")
                norm_to_raw.append(idx)
                prev_space = True
        else:
            norm_chars.append(mapped)
            norm_to_raw.append(idx)
            prev_space = False

    while norm_chars and norm_chars[-1] == " ":
        norm_chars.pop()
        norm_to_raw.pop()

    return "".join(norm_chars), norm_to_raw


def detect_language(text: str) -> str:
    hangul_count = len(re.findall(r"[가-힣]", text))
    latin_count = len(re.findall(r"[A-Za-z]", text))
    if hangul_count >= max(10, latin_count // 3):
        return "ko"
    return "en"


def validate_zip_archive(file_bytes: bytes, settings: Settings) -> zipfile.ZipFile:
    """ZIP 아카이브(DOCX, HWPX)의 항목 수, 해제 크기, 압축비, 경로 순회(ZIP Slip)를 점검한다."""
    if not file_bytes.startswith(ZIP_MAGIC):
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko="올바른 ZIP 기반 문서(DOCX/HWPX) 시그니처가 아닙니다. 파일이 손상되었거나 확장자가 잘못되었습니다.",
            status_code=400,
            remediation="정상적인 DOCX 또는 HWPX 파일인지 확인한 후 다시 업로드하세요.",
        )
    try:
        zf = zipfile.ZipFile(io.BytesIO(file_bytes))
    except Exception as exc:
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko=f"손상된 압축 문서 파일입니다: {exc}",
            status_code=400,
            remediation="문서를 다시 저장하거나 다른 형식(TXT/PDF/DOCX)으로 변환하세요.",
        ) from exc

    infolist = zf.infolist()
    if len(infolist) > settings.max_zip_entries:
        raise AppException(
            code="INPUT_TOO_LARGE",
            message_ko=f"문서 내부 압축 항목 수({len(infolist)}개)가 허용 상한({settings.max_zip_entries}개)을 초과했습니다.",
            status_code=400,
            remediation="불필요한 내장 객체를 제거하거나 텍스트 중심 문서로 분할하세요.",
        )

    total_uncompressed = 0
    for info in infolist:
        name = info.filename
        if ".." in name or name.startswith("/") or name.startswith("\\") or ":" in name:
            raise AppException(
                code="UNSUPPORTED_FORMAT",
                message_ko=f"안전하지 않은 내부 압축 경로가 감지되었습니다: {name}",
                status_code=400,
                remediation="정상적인 문서 작성 도구에서 생성된 파일을 업로드하세요.",
            )
        total_uncompressed += info.file_size
        if info.compress_size > 0:
            ratio = info.file_size / max(1, info.compress_size)
            if ratio > settings.max_zip_compression_ratio and info.file_size > 1024 * 1024:
                raise AppException(
                    code="INPUT_TOO_LARGE",
                    message_ko="비정상적으로 높은 압축비(ZIP 폭탄 의심)가 감지되어 업로드를 차단했습니다.",
                    status_code=400,
                )

    if total_uncompressed > settings.max_zip_uncompressed_bytes:
        raise AppException(
            code="FILE_TOO_LARGE",
            message_ko="문서 압축 해제 크기가 허용 상한을 초과했습니다.",
            status_code=400,
        )
    return zf


def _parse_txt_or_md(
    doc_id: str, doc_sha256: str, file_bytes: bytes
) -> Tuple[List[Segment], int]:
    try:
        text = file_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko="UTF-8 인코딩이 아닌 텍스트 파일입니다. UTF-8로 저장 후 업로드하세요.",
            status_code=400,
            remediation="메모장 또는 편집기에서 인코딩을 UTF-8로 선택하여 저장하세요.",
        ) from exc

    lines = text.splitlines()
    segments: List[Segment] = []
    heading_path = ""
    order_idx = 0

    block_lines: List[str] = []
    block_start = 1

    def flush_block(start_line: int, end_line: int, lines_buf: List[str]) -> None:
        nonlocal order_idx, heading_path
        raw_block = "\n".join(lines_buf).strip()
        if not raw_block:
            return
        first_line = lines_buf[0].strip()
        if HEADING_PREFIX_RE.match(first_line):
            heading_path = re.sub(r"^#+\s*", "", first_line).strip()

        norm_text, norm_map = normalize_with_map(raw_block)
        if not norm_text:
            return
        seg_id = f"seg-{doc_id}-{order_idx:04d}"
        segments.append(
            Segment(
                id=seg_id,
                document_id=doc_id,
                document_sha256=doc_sha256,
                locator=f"lines:{start_line}-{end_line}",
                heading_path=heading_path,
                raw_text=raw_block,
                normalized_text=norm_text,
                normalization_map=norm_map,
                order_index=order_idx,
            )
        )
        order_idx += 1

    for idx, line in enumerate(lines, start=1):
        if not line.strip():
            if block_lines:
                flush_block(block_start, idx - 1, block_lines)
                block_lines = []
            block_start = idx + 1
        else:
            if not block_lines:
                block_start = idx
            block_lines.append(line)

    if block_lines:
        flush_block(block_start, len(lines), block_lines)

    return segments, 1


def _parse_pdf(
    doc_id: str, doc_sha256: str, file_bytes: bytes, settings: Settings
) -> Tuple[List[Segment], int]:
    if not file_bytes.startswith(PDF_MAGIC):
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko="유효한 PDF 파일 시그니처(%PDF-)가 아닙니다.",
            status_code=400,
        )
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
    except Exception as exc:
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko=f"손상되었거나 읽을 수 없는 PDF 파일입니다: {exc}",
            status_code=400,
        ) from exc

    if reader.is_encrypted:
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko="암호화된 PDF 파일은 지원하지 않습니다. 암호를 해제한 후 업로드하세요.",
            status_code=400,
            remediation="PDF 암호 보호를 해제한 사본을 업로드하세요.",
        )

    num_pages = len(reader.pages)
    if num_pages > settings.max_pair_pages:
        raise AppException(
            code="INPUT_TOO_LARGE",
            message_ko=f"PDF 페이지 수({num_pages}쪽)가 허용 상한({settings.max_pair_pages}쪽)을 초과했습니다.",
            status_code=400,
            remediation=f"{settings.max_pair_pages}쪽 이하로 대상 장/절을 발췌하여 업로드하세요.",
        )

    page_texts: List[Tuple[int, str]] = []
    first_lines_counter: Dict[str, int] = {}
    empty_pages: List[int] = []
    for p_idx, page in enumerate(reader.pages, start=1):
        txt = (page.extract_text() or "").strip()
        if txt:
            page_texts.append((p_idx, txt))
        else:
            empty_pages.append(p_idx)

    # 브라우저판은 OCR 이 없다: 텍스트가 없는 쪽(스캔본)은 읽지 못하고 안내한다.
    ocr_pages: set = set()
    if empty_pages:
        if not page_texts:
            remediation = (
                "텍스트 선택이 가능한 원본 PDF 또는 DOCX/HWPX/TXT 파일을 업로드하세요. "
                "브라우저 버전은 OCR(스캔본 판독)을 지원하지 않습니다."
            )
            raise AppException(
                code="NEEDS_OCR",
                message_ko="스캔본 PDF이거나 추출 가능한 텍스트가 없습니다(NEEDS_OCR).",
                status_code=422,
                remediation=remediation,
            )

    for _p_idx, txt in page_texts:
        first_l = txt.splitlines()[0].strip()
        if len(first_l) < 80:
            first_lines_counter[first_l] = first_lines_counter.get(first_l, 0) + 1

    repeated_headers = {
        line for line, cnt in first_lines_counter.items() if cnt >= 3 and len(page_texts) >= 3
    }

    segments: List[Segment] = []
    heading_path = ""
    order_idx = 0

    def _starts_new_block(line: str) -> bool:
        """PDF는 줄 단위로 텍스트가 나오므로, 조항 머리·상위 제목·항/호 기호로 시작하는 줄에서만 블록을 끊고
        나머지(줄바꿈으로 이어진 문장)는 앞 블록에 이어 붙인다."""
        return bool(CLAUSE_HEADER_RE.match(line) or HEADING_ONLY_RE.match(line) or LIST_ITEM_RE.match(line))

    def _emit(page_no: int, block_lines: List[str]) -> None:
        nonlocal order_idx
        raw_blk = "\n".join(block_lines).strip()
        if not raw_blk:
            return
        norm_text, norm_map = normalize_with_map(raw_blk)
        if not norm_text:
            return
        segments.append(
            Segment(
                id=f"seg-{doc_id}-{order_idx:04d}",
                document_id=doc_id,
                document_sha256=doc_sha256,
                locator=f"page:{page_no}" + (" (OCR)" if page_no in ocr_pages else ""),
                heading_path=heading_path,
                raw_text=raw_blk,
                normalized_text=norm_text,
                normalization_map=norm_map,
                order_index=order_idx,
            )
        )
        order_idx += 1

    for page_no, p_text in page_texts:
        lines = p_text.splitlines()
        if lines and lines[0].strip() in repeated_headers:
            lines = lines[1:]
        block: List[str] = []
        for raw_line in lines:
            raw_blk = raw_line.strip()
            if not raw_blk or PAGE_NOISE_RE.match(raw_blk):
                continue
            is_heading = bool(HEADING_PREFIX_RE.match(raw_blk))
            if block and (is_heading or _starts_new_block(raw_blk)):
                _emit(page_no, block)
                block = []
            if is_heading:
                heading_path = raw_blk
                _emit(page_no, [raw_blk])  # 상위 제목은 단독 블록
                continue
            block.append(raw_blk)
        _emit(page_no, block)  # 쪽이 바뀌면 블록을 닫는다 (다음 쪽 첫 줄은 조항분할기가 앞 조항에 이어 붙임)

    return segments, num_pages


def _parse_docx(
    doc_id: str, doc_sha256: str, file_bytes: bytes, settings: Settings
) -> Tuple[List[Segment], int]:
    zf = validate_zip_archive(file_bytes, settings)
    for name in zf.namelist():
        if name.endswith(".xml"):
            xml_bytes = zf.read(name)
            SafeET.fromstring(xml_bytes)

    try:
        document = docx.Document(io.BytesIO(file_bytes))
    except Exception as exc:
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko=f"DOCX 문서를 읽는 중 오류가 발생했습니다: {exc}",
            status_code=400,
        ) from exc

    segments: List[Segment] = []
    heading_path = ""
    order_idx = 0
    p_idx = 0
    t_idx = 0

    # 문단과 표를 '본문에 나오는 순서대로' 읽는다. (document.paragraphs → document.tables 순으로 따로 읽으면
    # 모든 표가 문서 끝으로 몰려 마지막 조항(부칙 등)에 잘못 붙는다)
    from docx.table import Table as _DocxTable
    from docx.text.paragraph import Paragraph as _DocxParagraph

    for child in document.element.body.iterchildren():
        tag = child.tag.split("}")[-1]
        if tag == "p":
            para = _DocxParagraph(child, document)
            p_idx += 1
            raw_p = para.text.strip()
            if not raw_p:
                continue
            style_name = (para.style.name if para.style is not None else "").lower()
            if "heading" in style_name or HEADING_PREFIX_RE.match(raw_p):
                heading_path = raw_p
            norm_text, norm_map = normalize_with_map(raw_p)
            if not norm_text:
                continue
            segments.append(
                Segment(
                    id=f"seg-{doc_id}-{order_idx:04d}",
                    document_id=doc_id,
                    document_sha256=doc_sha256,
                    locator=f"para:{p_idx}",
                    heading_path=heading_path,
                    raw_text=raw_p,
                    normalized_text=norm_text,
                    normalization_map=norm_map,
                    order_index=order_idx,
                )
            )
            order_idx += 1
        elif tag == "tbl":
            t_idx += 1
            table = _DocxTable(child, document)
            col_headers: List[str] = []
            for r_idx, row in enumerate(table.rows, start=1):
                cells_text = [c.text.strip().replace("\n", " ") for c in row.cells]
                if r_idx == 1:
                    col_headers = cells_text
                row_header = cells_text[0] if cells_text else ""
                row_repr_parts = []
                for c_idx, cell_val in enumerate(cells_text, start=1):
                    col_h = col_headers[c_idx - 1] if c_idx - 1 < len(col_headers) else f"열{c_idx}"
                    row_repr_parts.append(f"[{col_h}] {cell_val}")
                if any(cells_text):
                    row_line = f"[표{t_idx} 행{r_idx}] " + " | ".join(row_repr_parts)
                    norm_text, norm_map = normalize_with_map(row_line)
                    segments.append(
                        Segment(
                            id=f"seg-{doc_id}-{order_idx:04d}",
                            document_id=doc_id,
                            document_sha256=doc_sha256,
                            locator=f"table:{t_idx}:r{r_idx}c1",
                            heading_path=heading_path,
                            raw_text=row_line,
                            normalized_text=norm_text,
                            normalization_map=norm_map,
                            order_index=order_idx,
                            table_location=TableLocation(
                                table_index=t_idx,
                                row_index=r_idx,
                                col_index=1,
                                table_title=heading_path or f"표 {t_idx}",
                                row_header=row_header,
                                col_header=" / ".join(col_headers),
                            ),
                        )
                    )
                    order_idx += 1

    return segments, 1


def _parse_hwpx(
    doc_id: str, doc_sha256: str, file_bytes: bytes, settings: Settings
) -> Tuple[List[Segment], int]:
    """HWPX(개방형 한/글 표준 ZIP+XML) 안전 파서 ([C])."""
    zf = validate_zip_archive(file_bytes, settings)
    section_files = sorted(
        [n for n in zf.namelist() if re.match(r"^Contents/section\d+\.xml$", n, re.IGNORECASE)],
        key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)),  # section10 이 section2 앞에 오지 않도록 숫자 순
    )
    if not section_files:
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko="HWPX 내부에 Contents/section*.xml 본문 구조가 없습니다.",
            status_code=400,
            remediation="한/글에서 표준 HWPX 형식으로 다시 저장 후 업로드하세요.",
        )

    segments: List[Segment] = []
    heading_path = ""
    order_idx = 0

    def _local(tag: str) -> str:
        return tag.split("}")[-1].lower()

    def _t_text(t_node) -> str:
        """<hp:t> 안의 혼합 내용(글자 + 탭/줄바꿈 요소 + 꼬리 글자)을 빠짐없이 읽는다."""
        parts = [t_node.text or ""]
        for sub in t_node:
            if _local(sub.tag) in ("tab", "linebreak", "nbspace", "fwspace"):
                parts.append(" ")
            parts.append(sub.tail or "")
        return "".join(parts)

    def _split_paragraph(p_elem) -> Tuple[str, list]:
        """문단의 본문 글자와, 문단 안에 들어 있는 표(한/글은 표를 문단 안 개체로 저장)를 분리한다."""
        texts: List[str] = []
        tables: list = []

        def walk(node) -> None:
            for child in node:
                tag = _local(child.tag)
                if tag == "tbl":
                    tables.append(child)  # 표 안쪽은 표 처리기로 넘김 (본문 글자에 섞지 않음)
                    continue
                if tag == "t":
                    texts.append(_t_text(child))
                    continue
                walk(child)

        walk(p_elem)
        return "".join(texts).strip(), tables

    def _emit_table(tbl_elem, sec_idx: int, table_idx: int) -> None:
        nonlocal order_idx
        col_headers: List[str] = []
        r_idx = 0
        for sub in tbl_elem:
            if _local(sub.tag) != "tr":
                continue
            r_idx += 1
            row_cells: List[str] = []
            for cell in sub:
                if _local(cell.tag) == "tc":
                    cell_texts = [t.strip() for t in cell.itertext() if t and t.strip()]
                    row_cells.append(" ".join(cell_texts))
            if r_idx == 1:
                col_headers = row_cells
            if not any(row_cells):
                continue
            parts = []
            for c_i, val in enumerate(row_cells, start=1):
                ch = col_headers[c_i - 1] if c_i - 1 < len(col_headers) else f"열{c_i}"
                parts.append(f"[{ch}] {val}")
            row_line = f"[표{table_idx} 행{r_idx}] " + " | ".join(parts)
            norm_text, norm_map = normalize_with_map(row_line)
            segments.append(
                Segment(
                    id=f"seg-{doc_id}-{order_idx:04d}",
                    document_id=doc_id,
                    document_sha256=doc_sha256,
                    locator=f"sec:{sec_idx}/table:{table_idx}:r{r_idx}c1",
                    heading_path=heading_path,
                    raw_text=row_line,
                    normalized_text=norm_text,
                    normalization_map=norm_map,
                    order_index=order_idx,
                    table_location=TableLocation(
                        table_index=table_idx,
                        row_index=r_idx,
                        col_index=1,
                        table_title=heading_path or f"표 {table_idx}",
                        row_header=row_cells[0] if row_cells else "",
                        col_header=" / ".join(col_headers),
                    ),
                )
            )
            order_idx += 1

    for sec_idx, sec_name in enumerate(section_files):
        xml_bytes = zf.read(sec_name)
        root = SafeET.fromstring(xml_bytes)
        para_idx = 0
        table_idx = 0

        for elem in list(root):
            local_tag = _local(elem.tag)
            if local_tag == "tbl":  # 구역 바로 아래 놓인 표
                table_idx += 1
                _emit_table(elem, sec_idx, table_idx)
            elif local_tag == "p":
                raw_p, inner_tables = _split_paragraph(elem)
                if raw_p:
                    para_idx += 1
                    if HEADING_PREFIX_RE.match(raw_p):
                        heading_path = raw_p
                    norm_text, norm_map = normalize_with_map(raw_p)
                    if norm_text:
                        segments.append(
                            Segment(
                                id=f"seg-{doc_id}-{order_idx:04d}",
                                document_id=doc_id,
                                document_sha256=doc_sha256,
                                locator=f"sec:{sec_idx}/para:{para_idx}",
                                heading_path=heading_path,
                                raw_text=raw_p,
                                normalized_text=norm_text,
                                normalization_map=norm_map,
                                order_index=order_idx,
                            )
                        )
                        order_idx += 1
                for tbl in inner_tables:  # 문단 안에 들어 있는 표 (실제 한/글 저장 파일의 일반적 구조)
                    table_idx += 1
                    _emit_table(tbl, sec_idx, table_idx)

    return segments, 1


def ingest_document_bytes(
    filename: str,
    file_bytes: bytes,
    title: Optional[str] = None,
    version_label: str = "",
    source_url: Optional[str] = None,
    source_kind: str = "user",
    data_class: str = "internal",
    permission_confirmed: bool = False,
    doc_id: Optional[str] = None,
    settings: Optional[Settings] = None,
) -> Tuple[Document, List[Segment]]:
    """업로드된 바이트를 검사·파싱하여 Document와 Segment 목록을 생성하고 안전하게 저장한다."""
    cfg = settings or get_settings()

    if len(file_bytes) > cfg.max_upload_bytes:
        raise AppException(
            code="FILE_TOO_LARGE",
            message_ko=f"파일 크기({len(file_bytes) / (1024*1024):.1f}MB)가 허용 한도({cfg.max_upload_bytes // (1024*1024)}MB)를 초과했습니다.",
            status_code=413,
            remediation="25MB 이하의 파일로 분할하여 업로드하세요.",
        )

    if len(file_bytes) == 0:
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko="빈 파일(0 바이트)은 업로드할 수 없습니다.",
            status_code=400,
            remediation="내용이 포함된 기술규정 문서를 선택하세요.",
        )

    ext = Path(filename).suffix.lower()

    if ext == ".hwp" or file_bytes.startswith(OLE2_MAGIC):
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko="구형 바이너리 HWP 형식(.hwp)은 지원하지 않습니다.",
            status_code=415,
            remediation="한/글 프로그램에서 개방형 문서 형식인 HWPX(.hwpx), DOCX(.docx) 또는 텍스트형 PDF(.pdf)로 변환한 후 업로드하세요.",
        )

    sha256_hex = hashlib.sha256(file_bytes).hexdigest()
    final_doc_id = doc_id or str(uuid.uuid4())

    if ext in (".txt", ".md"):
        media_type = "text/markdown" if ext == ".md" else "text/plain"
        segments, page_count = _parse_txt_or_md(final_doc_id, sha256_hex, file_bytes)
    elif ext == ".pdf":
        media_type = "application/pdf"
        segments, page_count = _parse_pdf(final_doc_id, sha256_hex, file_bytes, cfg)
    elif ext == ".docx":
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        segments, page_count = _parse_docx(final_doc_id, sha256_hex, file_bytes, cfg)
    elif ext == ".hwpx":
        media_type = "application/hwp+zip"
        segments, page_count = _parse_hwpx(final_doc_id, sha256_hex, file_bytes, cfg)
    else:
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko=f"지원하지 않는 파일 확장자({ext})입니다. P0 지원 형식: TXT, MD, PDF, DOCX, HWPX.",
            status_code=415,
            remediation="TXT, MD, 텍스트형 PDF, DOCX, HWPX 형식 중 하나로 변환하여 업로드하세요.",
        )

    if not segments:
        raise AppException(
            code="UNSUPPORTED_FORMAT",
            message_ko="문서에서 추출된 유효 본문 텍스트가 없습니다. 빈 문서는 분석할 수 없습니다.",
            status_code=422,
            remediation="본문 텍스트가 포함된 규정 파일을 업로드하세요.",
        )

    # 브라우저판: 원본 파일을 디스크에 저장하지 않는다 (메모리에서만 처리).

    combined_text = " ".join(s.raw_text for s in segments[:20])
    lang = detect_language(combined_text)

    doc = Document(
        id=final_doc_id,
        sha256=sha256_hex,
        filename=Path(filename).name,
        media_type=media_type,
        title=title.strip() if title and title.strip() else Path(filename).stem,
        language=lang,
        source_url=source_url.strip() if source_url and source_url.strip() else None,
        source_kind=source_kind if source_kind in ("official", "user", "synthetic") else "user",
        data_class=data_class if data_class in ("public", "internal", "restricted") else "internal",
        permission_confirmed=bool(permission_confirmed),
        version_label=version_label.strip(),
        imported_at=utc_now_iso(),
        extraction_status="succeeded_ocr" if any(sg.locator.endswith("(OCR)") for sg in segments) else "succeeded",
        parser_version=PARSER_VERSION,
        page_count=page_count,
        is_deleted=False,
    )
    return doc, segments
