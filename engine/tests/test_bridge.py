"""Web Worker 연결부(bridge) 계약 테스트 — 브라우저가 받는 JSON·파일 형태와 오류 안내."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from kats_diff import bridge

SAMPLES = Path(__file__).resolve().parents[1] / "samples"
FIX = Path(__file__).resolve().parent / "fixtures" / "realistic"


class BridgeTest(unittest.TestCase):
    def test_analyze_review_targets_export(self) -> None:
        d = SAMPLES / "pair3_en_battery"
        out = json.loads(
            bridge.run_analyze(
                "old.pdf",
                (d / "old_battery_2022_revA.pdf").read_bytes(),
                "new.pdf",
                (d / "new_battery_2026_revB.pdf").read_bytes(),
                json.dumps({"title": "배터리", "isSynthetic": True, "targetDate": "2026-11-05"}),
                progress=lambda pct, msg: None,
            )
        )
        self.assertTrue(out["ok"])
        view = out["view"]
        self.assertEqual(view["project"]["title"], "배터리")
        self.assertEqual(view["project"]["target_date"], "2026-11-05")
        self.assertTrue(view["coverage"]["is_complete"])

        targets = json.loads(bridge.run_targets())
        self.assertTrue(targets["ok"])
        self.assertTrue(targets["targets"])

        cid = view["changes"][0]["id"]
        rev = json.loads(bridge.run_review("change", cid, "confirmed", "확인"))
        self.assertTrue(rev["ok"])
        changed = next(c for c in rev["view"]["changes"] if c["id"] == cid)
        self.assertEqual(changed["review_status"], "confirmed")
        self.assertEqual(changed["reviewer_note"], "확인")

        ok, data, mime, name = bridge.run_export("xlsx")
        self.assertTrue(ok)
        self.assertTrue(data.startswith(b"PK"))
        self.assertIn("spreadsheetml", mime)
        self.assertTrue(name.endswith(".xlsx"))

        bad = json.loads(bridge.run_review("change", cid, "maybe", ""))
        self.assertFalse(bad["ok"])
        self.assertEqual(bad["error"]["code"], "VALIDATION_ERROR")

    def test_errors_are_reported_with_remediation(self) -> None:
        scanned = (FIX / "scanned_en.pdf").read_bytes()
        out = json.loads(bridge.run_analyze("a.pdf", scanned, "b.pdf", scanned, "{}"))
        self.assertFalse(out["ok"])
        self.assertEqual(out["error"]["code"], "NEEDS_OCR")
        self.assertIn("OCR", out["error"]["remediation"])

        hwp = json.loads(bridge.run_analyze("a.hwp", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"0" * 100, "b.txt", "제1조 내용".encode(), "{}"))
        self.assertEqual(hwp["error"]["code"], "UNSUPPORTED_FORMAT")
        self.assertIn("HWPX", hwp["error"]["remediation"])


if __name__ == "__main__":
    unittest.main()
