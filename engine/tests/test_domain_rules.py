"""단위 테스트 (T2, T3, T4, T5, T6, T7, T9 및 수식 주입 방어 검증)."""
from __future__ import annotations

import unittest
from decimal import Decimal

from kats_diff.aligner import align_clauses_pipeline, validate_alignment_coverage
from kats_diff.change_extractor import build_checklist_items, extract_changes_for_alignments
from kats_diff.numeric_date import (
    compare_numeric_facts,
    extract_and_compare_dates,
    extract_numeric_facts,
)
from kats_diff.segmenter import segment_clauses
from kats_diff.schemas import Alignment, Change, Clause, Document
from kats_diff.verifier import create_and_verify_evidence
from kats_diff.exporter import sanitize_spreadsheet_cell
from kats_diff.parser import ingest_document_bytes


class DomainRulesUnitTest(unittest.TestCase):
    def test_t2_moved_clause_vs_moved_and_changed(self) -> None:
        """T2: 번호만 바뀐 동일 조항을 실질변경과 구분하며, 이동+변경은 둘 다 표시한다."""
        old_txt = (
            "제1장 안전기준\n\n"
            "제1조(충격시험) 외함은 충격시험 후 파손되지 아니하여야 한다.\n\n"
            "제2조(온도제한) 과열방지장치는 시험을 면제한다.\n"
        ).encode("utf-8")
        new_txt = (
            "제1장 안전기준\n\n"
            "제3조(충격시험) 외함은 충격시험 후 파손되지 아니하여야 한다.\n\n"
            "제4조(온도제한) 과열방지장치는 시험을 면제하지 아니한다.\n"
        ).encode("utf-8")

        old_doc, old_segs = ingest_document_bytes("old.txt", old_txt, doc_id="doc-t2-old")
        new_doc, new_segs = ingest_document_bytes("new.txt", new_txt, doc_id="doc-t2-new")
        old_clauses = segment_clauses(old_doc.id, "old", old_segs)
        new_clauses = segment_clauses(new_doc.id, "new", new_segs)

        alignments, _, cov = align_clauses_pipeline(
            "proj-t2", old_doc, new_doc, old_clauses, new_clauses, old_segs, new_segs
        )
        self.assertTrue(cov.is_complete)
        changes, _ = extract_changes_for_alignments(
            "proj-t2", old_doc, new_doc, old_clauses, new_clauses, old_segs, new_segs, alignments
        )
        self.assertEqual(len(changes), 2)

        # 제1조 -> 제3조: 번호 이동(moved) + 내용 변경 없음(unchanged)
        c1 = changes[0]
        al1 = alignments[0]
        self.assertIn("moved", al1.flags)
        self.assertEqual(c1.semantic_status, "unchanged")

        # 제2조 -> 제4조: 번호 이동(moved) + 실질 변경(changed)
        c2 = changes[1]
        al2 = alignments[1]
        self.assertIn("moved", al2.flags)
        self.assertEqual(c2.semantic_status, "changed")
        self.assertIn("번호이동", c2.summary_ko)

    def test_t3_t4_split_merge_repeated_and_unmatched_invariant(self) -> None:
        """T3 & T4: 분할·병합·반복번호 처리, 커버리지 불변식(중복/누락 0), 미매칭 조항의 삭제/신설 확정 보류."""
        old_txt = (
            "제1장 전기안전\n\n"
            "3.1 절연거리 기준은 정격부하에서 10 mm 이상이어야 한다.\n\n"
            "3.2 배터리 보호회로 및 전원코드 인장강도를 확보하여야 한다.\n\n"
            "3.3 구형 수은릴레이 사용 특례 조항이다.\n\n"
            "ANNEX A 환경시험\n\n"
            "3.1 진동시험은 IEC 60068-2-6 표준에 따라 수행한다.\n"
        ).encode("utf-8")
        new_txt = (
            "제1장 전기안전\n\n"
            "3.1 절연거리 기준은 정격부하에서 12 mm 이상이어야 한다.\n\n"
            "3.2.1 배터리 보호회로는 2중 과충전 차단기능을 확보하여야 한다.\n\n"
            "3.2.2 전원코드 인장강도는 100N 시험을 통과하여야 한다.\n\n"
            "3.9 무선 원격제어 보안 인증을 수행하여야 한다.\n\n"
            "ANNEX A 환경시험\n\n"
            "3.1 진동시험은 IEC 60068-2-6:2024 표준에 따라 수행한다.\n"
        ).encode("utf-8")

        old_doc, old_segs = ingest_document_bytes("old_t3.txt", old_txt, doc_id="doc-t3-old")
        new_doc, new_segs = ingest_document_bytes("new_t3.txt", new_txt, doc_id="doc-t3-new")
        old_clauses = segment_clauses(old_doc.id, "old", old_segs)
        new_clauses = segment_clauses(new_doc.id, "new", new_segs)

        alignments, _, cov = align_clauses_pipeline(
            "proj-t3", old_doc, new_doc, old_clauses, new_clauses, old_segs, new_segs
        )
        self.assertTrue(cov.is_complete)
        self.assertEqual(cov.duplicate_old, 0)
        self.assertEqual(cov.duplicate_new, 0)
        self.assertEqual(cov.accounted_old, len(old_clauses))
        self.assertEqual(cov.accounted_new, len(new_clauses))

        changes, _ = extract_changes_for_alignments(
            "proj-t3", old_doc, new_doc, old_clauses, new_clauses, old_segs, new_segs, alignments
        )
        # T4: 미매칭 조항은 deletion_candidate / addition_candidate이며 review_status == 'unreviewed'
        unmatched_changes = [
            c for c in changes if c.semantic_status in ("deletion_candidate", "addition_candidate")
        ]
        self.assertEqual(len(unmatched_changes), 2)
        for uc in unmatched_changes:
            self.assertEqual(uc.review_status, "unreviewed")
            self.assertTrue("후보" in uc.summary_ko)

        # 중복 할당이 발생하면 cov.is_complete가 False가 되는지 검증 (T9)
        bad_alignments = list(alignments) + [
            Alignment(
                id="aln-dup",
                project_id="proj-t3",
                old_clause_ids=[old_clauses[0].id],
                new_clause_ids=[],
                relationship="unmatched_old",
            )
        ]
        bad_cov = validate_alignment_coverage("proj-t3", old_clauses, new_clauses, bad_alignments)
        self.assertFalse(bad_cov.is_complete)
        self.assertGreater(bad_cov.duplicate_old, 0)

    def test_t5_t6_numeric_units_boundaries_conditions_and_standard_years(self) -> None:
        """T5 & T6: 500mA=0.5A 동등, 부등호 경계 차이, 상한/하한 강화/완화, 다른 시험조건 검토, 표준번호 연도 배제."""
        # T6: 표준번호 KS C IEC 60335-2-15:2024에서 2024나 60335를 측정치로 추출하지 않음
        std_text = "주방기기는 KS C IEC 60335-2-15:2024 및 ISO 13849-1:2023 표준을 적용한다."
        std_facts = extract_numeric_facts(std_text)
        self.assertEqual(len(std_facts), 0)

        # T5-1: 500mA 이하 vs 0.5A 이하 (동일 조건 -> numeric_equivalent)
        f_old_1 = extract_numeric_facts("상온(25°C) 정격부하에서 누설전류는 500 mA 이하이어야 한다.")
        f_new_1 = extract_numeric_facts("상온(25°C) 정격부하에서 누설전류는 0.5 A 이하이어야 한다.")
        d1 = compare_numeric_facts(f_old_1, f_new_1)
        self.assertEqual(len(d1), 1)
        self.assertEqual(d1[0].status, "numeric_equivalent")
        self.assertEqual(Decimal(d1[0].old_fact.canonical_decimal), Decimal("0.5"))

        # T5-2: 10mm 이하 vs 10mm 미만 (부등호 경계 변경 -> boundary_changed)
        f_old_2 = extract_numeric_facts("정격부하에서 개구부 간격은 10 mm 이하이어야 한다.")
        f_new_2 = extract_numeric_facts("정격부하에서 개구부 간격은 10 mm 미만이어야 한다.")
        d2 = compare_numeric_facts(f_old_2, f_new_2)
        self.assertEqual(d2[0].status, "boundary_changed")

        # T5-3: 상한 감소(10mm 이하 -> 8mm 이하: 강화) vs 하한 감소(10mm 이상 -> 8mm 이상: 완화)
        f_upper_old = extract_numeric_facts("정격부하에서 변형량은 10 mm 이하이어야 한다.")
        f_upper_new = extract_numeric_facts("정격부하에서 변형량은 8 mm 이하이어야 한다.")
        self.assertEqual(compare_numeric_facts(f_upper_old, f_upper_new)[0].status, "tightened")

        f_lower_old = extract_numeric_facts("정격부하에서 최소 연면거리는 10 mm 이상이어야 한다.")
        f_lower_new = extract_numeric_facts("정격부하에서 최소 연면거리는 8 mm 이상이어야 한다.")
        self.assertEqual(compare_numeric_facts(f_lower_old, f_lower_new)[0].status, "relaxed")

        # T5-4: 같은 숫자(0.75mA)이나 다른 시험조건(25°C vs 40°C 고습) -> condition_changed_review
        f_cond_old = extract_numeric_facts("상온(25°C) 정상작동 조건에서 누설전류는 0.75 mA 이하이어야 한다.")
        f_cond_new = extract_numeric_facts("고온(40°C) 고습(90% RH) 단일고장 조건에서 누설전류는 0.75 mA 이하이어야 한다.")
        d_cond = compare_numeric_facts(f_cond_old, f_cond_new)
        self.assertEqual(d_cond[0].status, "condition_changed_review")
        self.assertFalse(d_cond[0].calculable)

    def test_t7_dates_roles_and_unconfirmed_deadlines(self) -> None:
        """T7: 시행일/유예종료일/제조일 기준 구분 및 미확정 기한('공포 후 6개월') 체크리스트 미확정 유지."""
        old_d = "부칙 제1조 이 규정은 2024년 1월 1일부터 시행한다."
        new_d = "부칙 제1조 이 규정은 2027년 1월 1일 제조일 기준 제품부터 시행한다. 다만 기존 인증 모델은 2027년 6월 30일까지 유예기간을 둔다."
        deltas = extract_and_compare_dates(old_d, new_d)
        roles = [d.role for d in deltas]
        self.assertIn("effective_date", roles)
        self.assertIn("grace_period_end", roles)
        self.assertEqual(deltas[0].resolved_date, "2027-01-01")
        self.assertIn("제조일 기준", deltas[0].basis_note_ko)
        self.assertEqual(deltas[1].resolved_date, "2027-06-30")

        # 공포 후 6개월 상대기한 -> unconfirmed
        rel_deltas = extract_and_compare_dates("", "부칙 제2조 이 규정은 공포 후 6개월이 경과한 날부터 시행한다.")
        self.assertEqual(len(rel_deltas), 1)
        self.assertEqual(rel_deltas[0].status, "unconfirmed")
        self.assertIsNone(rel_deltas[0].resolved_date)

        # 체크리스트 생성 시 미확정 기한은 절대 확정(confirmed)되지 않음
        ch_unconf = Change(
            id="chg-u1",
            project_id="proj-t7",
            alignment_id="aln-1",
            categories=["시행일/유예기간"],
            semantic_status="changed",
            summary_ko="공포 후 6개월 시행",
            date_deltas=rel_deltas,
            verification_status="valid",
        )
        chk_items = build_checklist_items("proj-t7", [ch_unconf])
        self.assertEqual(len(chk_items), 1)
        self.assertEqual(chk_items[0].due_date_status, "unconfirmed")
        self.assertIsNone(chk_items[0].due_date)

    def test_t9_invalid_evidence_rejected_from_checklist_and_formula_sanitization(self) -> None:
        """T9: 원문에 없는 잘못된 인용구는 invalid 처리되며 체크리스트에서 배제된다."""
        raw_bytes = "제1조(안전기준) 누설전류는 0.5 A 이하이어야 한다.\n".encode("utf-8")
        doc, segs = ingest_document_bytes("ev_test.txt", raw_bytes, doc_id="doc-ev")
        segs_by_id = {s.id: s for s in segs}

        valid_ev = create_and_verify_evidence(doc, segs_by_id, segs[0].id, "누설전류는 0.5 A 이하")
        self.assertEqual(valid_ev.verification_status, "valid")
        self.assertGreaterEqual(valid_ev.raw_start, 0)

        hallucinated_ev = create_and_verify_evidence(doc, segs_by_id, segs[0].id, "원문에 전혀 없는 창작 문구입니다")
        self.assertEqual(hallucinated_ev.verification_status, "invalid")

        # 깨진 근거(invalid)를 가진 Change는 ChecklistBuilder에서 제외됨
        bad_change = Change(
            id="chg-bad",
            project_id="proj-ev",
            alignment_id="aln-bad",
            categories=["기술적 허용치"],
            semantic_status="changed",
            summary_ko="깨진 근거 변경",
            verification_status="invalid",
        )
        self.assertEqual(len(build_checklist_items("proj-ev", [bad_change])), 0)

        # 수식 주입 방지 검증 ([E])
        self.assertEqual(sanitize_spreadsheet_cell("=SUM(A1:A10)"), "'=SUM(A1:A10)")
        self.assertEqual(sanitize_spreadsheet_cell("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0")


if __name__ == "__main__":
    unittest.main()
