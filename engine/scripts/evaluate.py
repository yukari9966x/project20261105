#!/usr/bin/env python3
"""가상 규정 평가셋(정답 레이블) 평가 — 원본 kats-regulation-diff/scripts/evaluate.py 를 브라우저 파이프라인으로 이식.

    python engine/scripts/evaluate.py --mode rules     # 규칙 엔진 단독 (브라우저 '키 없음' 모드와 같음)
    python engine/scripts/evaluate.py --mode fixture   # 기록된 AI 응답 재생 + 규칙 엔진 (회귀 점검)
    python engine/scripts/evaluate.py --mode all

'조항 커버리지율'은 모든 조항이 정확히 한 번 결과에 들어갔는지 보는 불변식 점검이며 정확도 지표가 아니다.
실측하지 않은 값은 보고하지 않는다. 결과 JSON 은 --out 으로 저장한다.
"""
from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

ENGINE_DIR = Path(__file__).resolve().parents[1]
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from kats_diff.pipeline import ENGINE_VERSION, analyze  # noqa: E402

SAMPLES = ENGINE_DIR / "samples"
GOLD_PATH = SAMPLES / "gold" / "gold_labels.json"
PAIRS = {
    "pair1_kr_appliance": ("old_appliance_2023_v1.txt", "new_appliance_2026_v2.txt"),
    "pair2_kr_lighting_hwpx": ("old_lighting_2022_v1.hwpx", "new_lighting_2026_v2.hwpx"),
    "pair3_en_battery": ("old_battery_2022_revA.pdf", "new_battery_2026_revB.pdf"),
    "pair4_en_machinery": ("old_machinery_2021_v1.docx", "new_machinery_2026_v2.docx"),
}


def run_evaluation(mode: str) -> Dict[str, Any]:
    t0 = time.perf_counter()
    gold = json.loads(GOLD_PATH.read_text(encoding="utf-8"))
    tot_old = tot_new = acc_old = acc_new = unresolved = 0
    aln_hits = aln_total = num_hits = num_total = 0
    tp = fp = fn = 0
    ev_total = ev_valid = 0
    cases: List[Dict[str, Any]] = []

    for spec in gold["pairs"]:
        pair_id = spec["pair_id"]
        old_name, new_name = PAIRS[pair_id]
        d = SAMPLES / pair_id
        st = analyze(old_name, (d / old_name).read_bytes(), new_name, (d / new_name).read_bytes(),
                     is_synthetic=True, use_recorded_ai=(mode == "fixture"), title=pair_id)
        cov = st.coverage
        tot_old += cov.total_old_clauses
        tot_new += cov.total_new_clauses
        acc_old += cov.accounted_old
        acc_new += cov.accounted_new
        unresolved += cov.unresolved_old + cov.unresolved_new

        old_by_id = {c.id: c for c in st.old_clauses}
        new_by_id = {c.id: c for c in st.new_clauses}
        chg_by_aln = {c.alignment_id: c for c in st.changes}
        ev_ids = {eid for ch in st.changes for eid in ch.evidence_old_ids + ch.evidence_new_ids}
        for eid in ev_ids:
            ev = st.evidences.get(eid)
            if ev is None:
                continue
            ev_total += 1
            ev_valid += ev.verification_status == "valid"

        for g in spec["gold_cases"]:
            aln_total += 1
            matched = None
            for al in st.alignments:
                o = [old_by_id[c].clause_number for c in al.old_clause_ids if c in old_by_id]
                n = [new_by_id[c].clause_number for c in al.new_clause_ids if c in new_by_id]
                if o == g["old_nums"] and n == g["new_nums"]:
                    hint = g.get("heading_hint", "")
                    if hint and hint.lower() not in " ".join(old_by_id[c].heading_path for c in al.old_clause_ids if c in old_by_id).lower():
                        continue
                    matched = al
                    break
            ok = matched is not None and matched.relationship == g["relationship"]
            if ok and g.get("expected_flag"):
                ok = g["expected_flag"] in matched.flags
            aln_hits += ok
            ch = chg_by_aln.get(matched.id) if matched else None
            exp_sem = g["semantic_status"]
            pred_sem = ch.semantic_status if ch else "missing"
            gold_pos = exp_sem != "unchanged"
            pred_pos = pred_sem not in ("unchanged", "missing")
            tp += gold_pos and pred_pos
            fp += (not gold_pos) and pred_pos
            fn += gold_pos and not pred_pos
            passed = None
            if g.get("must_not_extract_year_as_measurement"):
                num_total += 1
                passed = bool(ch is not None and len(ch.numeric_deltas) == 0)
            elif g.get("expected_numeric_status"):
                num_total += 1
                passed = g["expected_numeric_status"] in [x.status for x in (ch.numeric_deltas if ch else [])]
            elif g.get("expected_date_status"):
                num_total += 1
                passed = g["expected_date_status"] in [x.status for x in (ch.date_deltas if ch else [])]
            num_hits += bool(passed)
            cases.append({"case_id": g["case_id"], "pair_id": pair_id, "case_type": g["case_type"],
                          "alignment_matched": ok, "expected_semantic": exp_sem, "predicted_semantic": pred_sem,
                          "numeric_or_date_passed": passed})

    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    both = tot_old + tot_new
    return {
        "dataset_id": gold["dataset_id"],
        "mode": mode,
        "evaluation_mode": {"rules": "규칙 엔진 단독 (AI·기록 응답 없음, 브라우저 '키 없음' 모드)",
                            "fixture": "기록된 AI 응답 재생 + 규칙 엔진 (실제 AI 호출 아님)"}[mode],
        "engine_version": ENGINE_VERSION,
        "python": platform.python_version(),
        "measured_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
        "denominators": {"total_pairs": len(gold["pairs"]), "total_old_clauses": tot_old, "total_new_clauses": tot_new,
                         "gold_cases_count": aln_total, "numeric_and_date_cases_count": num_total,
                         "total_evidences_checked": ev_total},
        "metrics": {
            "alignment_accuracy": round(aln_hits / aln_total, 4) if aln_total else 0.0,
            "alignment_hits": f"{aln_hits}/{aln_total}",
            "change_detection_precision": round(precision, 4),
            "change_detection_recall": round(recall, 4),
            "change_detection_f1": round(f1, 4),
            "numeric_date_accuracy": round(num_hits / num_total, 4) if num_total else 0.0,
            "numeric_date_hits": f"{num_hits}/{num_total}",
            "evidence_validity_rate": round(ev_valid / ev_total, 4) if ev_total else 0.0,
            "evidence_valid_count": f"{ev_valid}/{ev_total}",
            "clause_coverage_rate(invariant)": round((acc_old + acc_new) / both, 4) if both else 0.0,
            "unresolved_clause_rate": round(unresolved / both, 4) if both else 0.0,
        },
        "cases": cases,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--mode", choices=["rules", "fixture", "all"], default="all")
    ap.add_argument("--out", type=Path, default=None, help="결과 JSON 저장 경로")
    args = ap.parse_args()
    modes = ["rules", "fixture"] if args.mode == "all" else [args.mode]
    reports = [run_evaluation(m) for m in modes]
    for r in reports:
        print(f"\n[{r['mode']}] {r['evaluation_mode']} — {r['dataset_id']} ({r['elapsed_ms']} ms)")
        for k, v in r["metrics"].items():
            print(f"  {k:34s} {v}")
        missed = [c["case_id"] for c in r["cases"] if not c["alignment_matched"] or c["numeric_or_date_passed"] is False]
        print(f"  불일치 사례: {', '.join(missed) if missed else '없음'}")
    if args.out:
        args.out.write_text(json.dumps(reports if len(reports) > 1 else reports[0], ensure_ascii=False, indent=2), encoding="utf-8")
    fixture = next((r for r in reports if r["mode"] == "fixture"), None)
    if fixture and fixture["metrics"]["alignment_accuracy"] < 1.0:
        return 1  # 기록 응답 재생은 회귀 점검이므로 100% 가 아니면 실패
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
