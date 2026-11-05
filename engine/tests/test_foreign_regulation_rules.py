"""해외규제 보강 규칙 테스트 (B10: 단위·부등호·날짜·다국어 조항번호)."""
from __future__ import annotations

import unittest

from kats_diff.numeric_date import (
    _find_dates,
    compare_numeric_facts,
    extract_and_compare_dates,
    extract_numeric_facts,
)
from kats_diff.patterns import CLAUSE_HEADER_RE, HEADING_ONLY_RE


def deltas(old: str, new: str):
    return compare_numeric_facts(extract_numeric_facts(old), extract_numeric_facts(new))


class ForeignRegulationRuleTest(unittest.TestCase):
    def test_content_units_and_negated_more_than(self) -> None:
        d = deltas("Batteries shall not contain more than 0.0005 % of mercury by weight.",
                   "Batteries shall not contain more than 0.0001 % of mercury by weight.")
        self.assertEqual([x.status for x in d], ["tightened"])  # 'not ... more than' = 상한
        d = deltas("Cadmium shall not exceed 100 mg/kg.", "Cadmium shall not exceed 0.01 %.")
        self.assertEqual(d[0].status, "numeric_equivalent")  # 100 mg/kg = 0.01 % = 100 ppm

    def test_more_units_case_sensitive(self) -> None:
        self.assertEqual(deltas("대기전력은 0.5 W 이하", "대기전력은 300 mW 이하")[0].status, "tightened")
        self.assertEqual(deltas("Rated output 1,500 W maximum", "Rated output 1.5 kW maximum")[0].status, "numeric_equivalent")
        self.assertEqual(deltas("주파수 2400 MHz 이하", "주파수 2.4 GHz 이하")[0].status, "numeric_equivalent")
        self.assertEqual(deltas("절연저항 2 MΩ 이상", "절연저항 5 MΩ 이상")[0].status, "tightened")
        self.assertEqual(deltas("소음 30 dB(A) 이하", "소음 35 dB(A) 이하")[0].status, "relaxed")
        f = extract_numeric_facts("시험전압은 500 V로 한다.")  # 단위 뒤 조사
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0].canonical_unit, "V")
        f = extract_numeric_facts("누설전류는 0,75 mA 이하")  # 소수점 쉼표
        self.assertEqual(f[0].decimal_value, "0.75")

    def test_table_cells_do_not_borrow_operators_from_neighbours(self) -> None:
        old = "[표1 행2] [구분] 실내용 | [정격색온도] 3000K~5000K | [최소 광효율 기준] 90 lm/W 이상"
        new = "[표1 행2] [구분] 실내용 | [정격색온도] 2700K~5000K | [최소 광효율 기준] 115 lm/W 이상"
        by_unit = {d.old_fact.raw_unit + d.old_fact.raw_value: d.status for d in deltas(old, new)}
        self.assertEqual(by_unit["lm/W90"], "tightened")
        self.assertEqual(by_unit["K3000"], "value_changed_review")  # 색온도 범위는 강화/완화 단정 금지
        d = deltas("[표1 행2] [부위] 외함 | [온도상승 한계] 60 K", "[표1 행2] [부위] 외함 | [온도상승 한계] 50 K")
        self.assertEqual(d[0].status, "tightened")  # 머리글 '한계' → 상한

    def test_foreign_date_formats(self) -> None:
        hits = _find_dates("By 18 February 2027; from March 3, 2028; 2027年1月1日起实施; 2026.5.1")
        self.assertEqual([iso for _, iso in hits], ["2027-02-18", "2028-03-03", "2027-01-01", "2026-05-01"])
        dd = extract_and_compare_dates("1. By 18 August 2026, batteries shall be marked",
                                       "1. By 18 February 2027, batteries shall be marked")
        self.assertEqual((dd[0].resolved_date, dd[0].status), ("2027-02-18", "confirmed"))
        dd = extract_and_compare_dates("This Regulation shall apply from 1 January 2026.",
                                       "This Regulation shall apply 18 months after the entry into force.")
        self.assertEqual((dd[0].role, dd[0].status), ("relative_period", "unconfirmed"))
        self.assertIsNone(dd[0].resolved_date)
        self.assertEqual(_find_dates("01/02/2027"), [])  # 일·월 순서가 모호한 표기는 추정하지 않음

    def test_foreign_clause_numbers_and_headings(self) -> None:
        cases = {
            "第十二条 产品应当符合": "第十二条",
            "第5條 表示": "第5條",
            "Artículo 5. Requisitos": "Artículo 5",
            "Art. 12 Kennzeichnung": "Art. 12",
            "§ 3 Anforderungen": "§ 3",
            "المادة (5) المتطلبات": "المادة (5)",
        }
        for text, num in cases.items():
            m = CLAUSE_HEADER_RE.match(text)
            self.assertIsNotNone(m, text)
            self.assertEqual(m.group("num"), num)
        for heading in ("第二章 技术要求", "附录A 试验方法", "CAPÍTULO II", "ANEXO I Requisitos", "Kapitel 2"):
            self.assertIsNotNone(HEADING_ONLY_RE.match(heading), heading)


if __name__ == "__main__":
    unittest.main()
