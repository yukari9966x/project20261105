"""실제 규정 문서 구조 회귀 테스트 (원본 tests/regression/test_realistic_documents.py 이식).

원본은 SQLite 작업 실행기(runner)로 돌렸지만, 브라우저판은 같은 도메인 함수를 pipeline.analyze()로 실행한다.
기대값(조항 번호·변경 탐지·근거 검증)은 원본과 같다. OCR 은 브라우저판에 없으므로 스캔본 안내만 검증한다.
"""
from __future__ import annotations

import time
import unittest
from pathlib import Path
from typing import Dict, List, Tuple

from kats_diff.parser import ingest_document_bytes
from kats_diff.pipeline import analyze
from kats_diff.schemas import AppException

FIX = Path(__file__).resolve().parent / "fixtures" / "realistic"


def run_pair(old_name: str, new_name: str) -> Dict:
    t0 = time.perf_counter()
    st = analyze(old_name, (FIX / old_name).read_bytes(), new_name, (FIX / new_name).read_bytes(), title="regression")
    elapsed = time.perf_counter() - t0
    by_id = {c.id: c for c in st.old_clauses + st.new_clauses}
    changes = {c.alignment_id: c for c in st.changes}
    rows: List[Tuple[List[str], List[str], str, object]] = []
    for a in st.alignments:
        rows.append(
            (
                [by_id[i].clause_number for i in a.old_clause_ids],
                [by_id[i].clause_number for i in a.new_clause_ids],
                a.relationship,
                changes.get(a.id),
            )
        )
    return {"state": st, "old": st.old_clauses, "new": st.new_clauses, "rows": rows, "elapsed": elapsed}


def changed_rows(result: Dict) -> List[Tuple[List[str], List[str], str, object]]:
    return [r for r in result["rows"] if r[3] is not None and r[3].semantic_status not in ("unchanged", "format_only")]


class RealisticDocumentTest(unittest.TestCase):
    def test_korean_notice_docx_paragraph_items_and_inline_table(self) -> None:
        """①②항·호가 별도 문단이고 표가 조항 중간에 있는 한국 고시형 DOCX."""
        r = run_pair("kr_notice_old.docx", "kr_notice_new.docx")
        self.assertIn(r["state"].run.status, ("succeeded", "partial"))
        nums = [c.clause_number for c in r["new"]]
        self.assertEqual(nums, ["P-1", "제1조", "제2조", "제3조", "제4조", "제5조", "제1조"])
        art3 = next(c for c in r["new"] if c.clause_number == "제3조")
        self.assertIn("② 클래스 I", art3.text)
        self.assertIn("③ 제2항의 측정은", art3.text)
        art4 = next(c for c in r["new"] if c.clause_number == "제4조")
        self.assertEqual(len(art4.table_cells), 3)
        addendum = r["new"][-1]
        self.assertEqual(addendum.heading_path, "부칙")
        self.assertEqual(addendum.table_cells, [])

        changed = {tuple(o): ch for o, n, rel, ch in changed_rows(r)}
        self.assertEqual(set(changed), {("제3조",), ("제4조",), ("제1조",)})
        self.assertIn("tightened", [d.status for d in changed[("제3조",)].numeric_deltas])
        self.assertTrue(changed[("제1조",)].date_deltas)
        for ch in changed.values():
            self.assertEqual(ch.verification_status, "valid")

    def test_eu_pdf_wrapped_lines_are_merged_into_articles(self) -> None:
        r = run_pair("eu_battery_old.pdf", "eu_battery_new.pdf")
        self.assertEqual([c.clause_number for c in r["old"]], ["1", "2", "3"])
        self.assertFalse(any(c.clause_number.startswith("P-") for c in r["old"] + r["new"]))
        changed = [tuple(o) for o, n, rel, ch in changed_rows(r)]
        self.assertEqual(changed, [("2",), ("3",)])
        for o, n, rel, ch in changed_rows(r):
            self.assertEqual(ch.verification_status, "valid")

    def test_single_phrase_insertion_does_not_cascade(self) -> None:
        r = run_pair("eu_battery_old.pdf", "eu_reflow_new.pdf")
        changed = changed_rows(r)
        self.assertEqual(len(changed), 1)
        o, n, rel, ch = changed[0]
        self.assertEqual((o, n), (["1"], ["1"]))
        self.assertIn("labelling, conformity assessment", ch.summary_ko)

    def test_hwpx_table_nested_inside_paragraph(self) -> None:
        r = run_pair("kr_lighting_nested_old.hwpx", "kr_lighting_nested_new.hwpx")
        art2 = next(c for c in r["new"] if c.clause_number == "제2조")
        self.assertEqual(len(art2.table_cells), 2)
        self.assertNotIn("시험항목기준", art2.text)
        art3 = next(c for c in r["new"] if c.clause_number == "제3조")
        self.assertIn("(표시) 제품에는", art3.text)
        changed = {tuple(o): ch for o, n, rel, ch in changed_rows(r)}
        self.assertEqual(set(changed), {("제2조",)})
        self.assertIn("tightened", [d.status for d in changed[("제2조",)].numeric_deltas])

    def test_txt_multi_paragraph_clause_and_unnumbered_addendum(self) -> None:
        r = run_pair("multi_paragraph_old.txt", "multi_paragraph_new.txt")
        nums = [c.clause_number for c in r["new"]]
        self.assertEqual(nums[:2], ["제1조", "제2조"])
        art2 = r["new"][1]
        self.assertIn("2. 측정값은 5 MΩ", art2.text)
        self.assertNotIn("공포한 날", art2.text)
        self.assertEqual(r["new"][-1].heading_path, "부칙")
        changed = [tuple(o) for o, n, rel, ch in changed_rows(r)]
        self.assertEqual(changed, [("제2조",)])

    def test_decimal_value_at_line_start_is_not_a_clause_header(self) -> None:
        from kats_diff.patterns import CLAUSE_HEADER_RE

        self.assertIsNone(CLAUSE_HEADER_RE.match("0.0005 % of mercury by weight"))
        self.assertIsNone(CLAUSE_HEADER_RE.match("2.4 GHz band devices shall"))
        self.assertIsNone(CLAUSE_HEADER_RE.match("1.5 mm 이상이어야 한다"))
        self.assertIsNotNone(CLAUSE_HEADER_RE.match("2.1 Overcharge cutoff"))
        self.assertIsNotNone(CLAUSE_HEADER_RE.match("A.1.2 시험 조건"))
        self.assertIsNotNone(CLAUSE_HEADER_RE.match("제3조의2(표시)"))


class ScannedPdfTest(unittest.TestCase):
    def test_scanned_pdf_returns_browser_guidance(self) -> None:
        """브라우저판은 OCR 이 없으므로 스캔본은 NEEDS_OCR 와 안내문을 돌려준다 (아키텍처: 'OCR 없음 → 화면에 안내')."""
        path = FIX / "scanned_en.pdf"
        with self.assertRaises(AppException) as err:
            ingest_document_bytes(filename=path.name, file_bytes=path.read_bytes())
        self.assertEqual(err.exception.code, "NEEDS_OCR")
        self.assertIn("OCR", err.exception.remediation)


class AlignmentPerformanceTest(unittest.TestCase):
    def test_many_edited_clauses_finish_quickly(self) -> None:
        """조항 120개가 모두 조금씩 바뀐 문서도 수 초 안에 정렬된다."""
        words = ("manufacturer shall ensure equipment complies essential safety requirements insulation "
                 "creepage clearance temperature leakage current marking instructions humidity voltage").split()
        old_lines, new_lines = [], []
        for i in range(120):
            body = " ".join(words[(i * 7 + k) % len(words)] for k in range(45))
            old_lines.append(f"{i // 10 + 1}.{i % 10 + 1} Requirement {i} {body} limit {i % 9 + 1} mA or less.")
            new_lines.append(old_lines[-1].replace("shall", "must", 1))
        t0 = time.perf_counter()
        st = analyze("perf_old.txt", "\n\n".join(old_lines).encode("utf-8"), "perf_new.txt", "\n\n".join(new_lines).encode("utf-8"))
        elapsed = time.perf_counter() - t0
        self.assertLess(elapsed, 30.0)
        self.assertTrue(st.coverage.is_complete)
        by_id = {c.id: c for c in st.old_clauses + st.new_clauses}
        wrong = [a for a in st.alignments
                 if [by_id[i].clause_number for i in a.old_clause_ids] != [by_id[i].clause_number for i in a.new_clause_ids]]
        self.assertEqual(wrong, [])


if __name__ == "__main__":
    unittest.main()
