"""브라우저 파이프라인 종단 테스트: 샘플 4쌍 분석 → 화면용 JSON → 5종 내보내기 → 파일 다시 열어 확인.

원본 엔진의 T1(업로드→분석→체크리스트→다운로드), T9(잘린 AI 응답·잘못된 인용은 성공으로 표시하지 않음),
T10(결과가 바뀌면 이전 검토를 승계하지 않음), T12(XLSX 7시트·DOCX 한글 표)를 메모리 파이프라인으로 확인한다.
"""
from __future__ import annotations

import io
import json
import unittest
from pathlib import Path

import docx
import openpyxl

from kats_diff.pipeline import analyze, apply_llm_outputs, export, llm_targets, set_review, to_view

SAMPLES = Path(__file__).resolve().parents[1] / "samples"
PAIRS = {
    "pair1_kr_appliance": ("old_appliance_2023_v1.txt", "new_appliance_2026_v2.txt"),
    "pair2_kr_lighting_hwpx": ("old_lighting_2022_v1.hwpx", "new_lighting_2026_v2.hwpx"),
    "pair3_en_battery": ("old_battery_2022_revA.pdf", "new_battery_2026_revB.pdf"),
    "pair4_en_machinery": ("old_machinery_2021_v1.docx", "new_machinery_2026_v2.docx"),
}


def run_sample(pair: str, **kw):
    old, new = PAIRS[pair]
    d = SAMPLES / pair
    return analyze(old, (d / old).read_bytes(), new, (d / new).read_bytes(), is_synthetic=True, title=pair, **kw)


class PipelineTest(unittest.TestCase):
    def test_all_samples_analyze_with_full_coverage_and_json_view(self) -> None:
        for pair in PAIRS:
            with self.subTest(pair=pair):
                st = run_sample(pair)
                self.assertTrue(st.coverage.is_complete, pair)
                self.assertEqual(st.coverage.duplicate_old + st.coverage.duplicate_new, 0)
                self.assertTrue(st.changes)
                view = to_view(st)
                json.dumps(view, ensure_ascii=False)  # 화면으로 넘길 수 있어야 함
                self.assertEqual(view["run"]["mode"], "demo")
                self.assertIn("가상 규정", view["notices"]["synthetic"])
                self.assertIn("AI 미사용", view["notices"]["mode"])
                for ch in view["changes"]:
                    for eid in ch["evidence_old_ids"] + ch["evidence_new_ids"]:
                        self.assertIn(eid, view["evidences"])
                        self.assertIn(view["evidences"][eid]["segment_id"], view["segments"])

    def test_numeric_equivalence_and_unconfirmed_deadline_on_korean_sample(self) -> None:
        st = run_sample("pair1_kr_appliance")
        statuses = {d.status for ch in st.changes for d in ch.numeric_deltas}
        self.assertIn("numeric_equivalent", statuses)  # 500 mA → 0.5 A
        unconfirmed = [d for ch in st.changes for d in ch.date_deltas if d.status == "unconfirmed"]
        self.assertTrue(unconfirmed)  # '공포 후 6개월' 은 확정하지 않는다
        for item in st.checklist_items:
            if item.due_date_status == "unconfirmed":
                self.assertIsNone(item.due_date)

    def test_exports_reopen_with_korean_sheets_and_tables(self) -> None:
        st = run_sample("pair1_kr_appliance")
        x_bytes, x_mime, x_name = export(st, "xlsx")
        self.assertTrue(x_name.endswith(".xlsx"))
        wb = openpyxl.load_workbook(io.BytesIO(x_bytes))
        self.assertEqual(len(wb.sheetnames), 7)
        d_bytes, _, _ = export(st, "docx")
        document = docx.Document(io.BytesIO(d_bytes))
        self.assertTrue(document.tables)
        self.assertTrue(any("가상" in p.text for p in document.paragraphs))
        for fmt in ("json", "md", "html"):
            data, mime, name = export(st, fmt)
            self.assertTrue(data)
            self.assertTrue(name.endswith("." + fmt))
        payload = json.loads(export(st, "json")[0])
        self.assertEqual(len(payload["alignments"]), len(st.alignments))

    def test_recorded_ai_replay_only_for_exact_sample_hashes(self) -> None:
        st = run_sample("pair1_kr_appliance", use_recorded_ai=True)
        self.assertTrue(st.fixture_replay)
        self.assertEqual(st.run.model_name, "fixture-exact-sha256")
        d = SAMPLES / "pair1_kr_appliance"
        old = (d / "old_appliance_2023_v1.txt").read_bytes() + b"\n"
        other = analyze("o.txt", old, "n.txt", (d / "new_appliance_2026_v2.txt").read_bytes(), use_recorded_ai=True)
        self.assertFalse(other.fixture_replay)  # 해시가 다르면 기록된 응답을 돌려주지 않는다
        self.assertTrue(any("기록된 AI 응답을 재생하지 않고" in e for e in other.run.errors))

    def test_llm_outputs_are_validated_and_reviews_reset(self) -> None:
        st = run_sample("pair1_kr_appliance")
        targets = llm_targets(st)
        self.assertTrue(targets)
        first = next(t for t in targets if t["old_clauses"] and t["new_clauses"])
        ch0 = next(c for c in st.changes if c.alignment_id == first["alignment_id"])
        set_review(st, "change", ch0.id, "confirmed", "확인함")
        self.assertEqual(len(st.reviews), 1)
        good = {
            "categories": ["기술적 허용치"],
            "semantic_status": "changed",
            "summary_ko": "LLM 요약: 허용치 표기가 바뀜",
            "old_fact": "",
            "new_fact": "",
            "changed_obligations": ["성적서 확인"],
            "scope_conditions": "",
            "uncertainties": [],
            "new_quote": "이 문장은 원문에 없다",
        }
        truncated = '{"categories": ["기타"], "summary_ko": ""}'
        second = next(t for t in targets if t["lookup_key"] != first["lookup_key"])
        res = apply_llm_outputs(st, {first["lookup_key"]: good, second["lookup_key"]: truncated}, model="test-model", calls=2)
        self.assertEqual(res["accepted"], [first["lookup_key"]])
        self.assertIn(second["lookup_key"], res["rejected"])
        self.assertEqual(st.run.mode, "live")
        self.assertEqual(st.run.status, "partial")  # 잘린 응답이 있으면 성공으로 표시하지 않음
        self.assertEqual(st.reviews, [])  # 결과가 바뀌면 이전 검토를 승계하지 않음
        changed = next(c for c in st.changes if c.alignment_id == first["alignment_id"])
        self.assertEqual(changed.summary_ko, "LLM 요약: 허용치 표기가 바뀜")
        self.assertEqual(changed.verification_status, "invalid")  # 원문에 없는 인용은 근거 검증 실패
        self.assertFalse(any(i.change_id == changed.id for i in st.checklist_items))  # 체크리스트에서 제외
        view = to_view(st)
        self.assertIn("AI 요약 포함", view["notices"]["mode"])


if __name__ == "__main__":
    unittest.main()
