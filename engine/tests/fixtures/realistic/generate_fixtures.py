"""실제 규정 문서 구조를 흉내 낸 회귀 테스트용 문서 생성기 (개발용, reportlab 필요).

생성된 파일은 저장소에 함께 커밋되어 있으므로 테스트 실행에는 이 스크립트가 필요 없다.
  python tests/fixtures/realistic/generate_fixtures.py
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import docx
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

OUT = Path(__file__).resolve().parent


def kr_docx(path: Path, leak: str, add_hang3: bool, table_val: str, effective: str) -> None:
    """한국 고시형: 조 머리 문단 + ①②항 별도 문단 + 호 목록 + 본문 중간 표 + 부칙."""
    d = docx.Document()
    import datetime as _dt

    d.core_properties.created = _dt.datetime(2026, 1, 1)
    d.core_properties.modified = _dt.datetime(2026, 1, 1)
    d.add_paragraph("전기용품 안전기준 고시")
    d.add_paragraph("제1장 총칙")
    d.add_paragraph("제1조(목적) 이 고시는 「전기용품 및 생활용품 안전관리법」 제15조에 따라 전기용품의 안전기준을 정함을 목적으로 한다.")
    d.add_paragraph("제2조(정의) 이 고시에서 사용하는 용어의 뜻은 다음과 같다.")
    d.add_paragraph('1. "정격전압"이란 제조자가 기기에 지정한 공급전압을 말한다.')
    d.add_paragraph('2. "누설전류"란 정상 사용상태에서 접근 가능한 금속부와 대지 사이에 흐르는 전류를 말한다.')
    d.add_paragraph("제2장 안전요구사항")
    d.add_paragraph("제3조(누설전류) ① 제조업자는 기기의 누설전류를 측정하여 기록을 보관하여야 한다.")
    d.add_paragraph(f"② 클래스 I 기기의 누설전류는 정격전압의 1.06배에서 {leak} 이하이어야 한다.")
    if add_hang3:
        d.add_paragraph("③ 제2항의 측정은 KS C IEC 60990:2016에 따른 측정회로를 사용하여야 한다.")
    d.add_paragraph("제4조(온도상승) 정상 동작 시 각 부위의 온도상승 한계는 다음 표와 같다.")
    t = d.add_table(rows=3, cols=2)
    t.cell(0, 0).text = "부위"
    t.cell(0, 1).text = "온도상승 한계"
    t.cell(1, 0).text = "외함 표면"
    t.cell(1, 1).text = table_val
    t.cell(2, 0).text = "전원코드 피복"
    t.cell(2, 1).text = "50 K"
    d.add_paragraph("제5조(표시) 기기에는 정격전압, 정격소비전력 및 제조자명을 지워지지 않게 표시하여야 한다.")
    d.add_paragraph("부칙")
    d.add_paragraph(f"제1조(시행일) 이 고시는 {effective}부터 시행한다.")
    d.save(str(path))


def eu_pdf(path: Path, limit: str, date: str, insert_phrase: bool = False) -> None:
    """EU 규정형: Article 머리 + 번호 문단, 긴 문장이 여러 줄로 줄바꿈되는 PDF."""
    st = getSampleStyleSheet()
    body = []

    def para(text: str, style: str = "BodyText") -> None:
        body.append(Paragraph(text, st[style]))
        body.append(Spacer(1, 4))

    design = "design, labelling, conformity assessment," if insert_phrase else "design,"
    para("CHAPTER I GENERAL PROVISIONS", "Heading2")
    para("Article 1 Subject matter")
    para(f"1. This Regulation lays down requirements regarding the {design} manufacture and placing on the market of portable batteries and light means of transport batteries, in order to ensure the free movement of such products within the internal market while protecting human health and the environment.")
    para("2. This Regulation applies to all categories of batteries, regardless of their shape, volume, weight, design, material composition, chemistry, use or purpose, including batteries incorporated into or added to appliances.")
    para("Article 2 Restriction of hazardous substances")
    para(f"1. Batteries, whether or not incorporated into appliances, light means of transport or other vehicles, shall not contain more than {limit} of mercury (expressed as mercury metal) by weight, and the economic operator shall keep technical documentation demonstrating compliance with this requirement for a period of ten years.")
    para("2. Portable batteries shall not contain more than 0.002 % of cadmium (expressed as cadmium metal) by weight.")
    para("Article 3 Labelling")
    para(f"1. By {date}, batteries shall be marked with a label containing general information about them, including the manufacturer identification, the battery category, the date of manufacture and the chemistry, as specified in Part A of Annex VI.")
    doc = SimpleDocTemplate(str(path), pagesize=A4, invariant=1)
    doc.build(body)


def hwpx_nested(path: Path, limit: str) -> None:
    """한/글 실제 저장 구조처럼 표가 문단(<hp:p><hp:run><hp:tbl>) 안에 들어 있는 HWPX."""
    ns = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"'

    def p(text: str) -> str:
        return f'<hp:p><hp:run><hp:t>{text}</hp:t></hp:run></hp:p>'

    def cell(text: str) -> str:
        return f'<hp:tc><hp:subList><hp:p><hp:run><hp:t>{text}</hp:t></hp:run></hp:p></hp:subList></hp:tc>'

    table = (
        '<hp:p><hp:run><hp:tbl>'
        f'<hp:tr>{cell("시험항목")}{cell("기준")}</hp:tr>'
        f'<hp:tr>{cell("대기전력")}{cell(limit)}</hp:tr>'
        '</hp:tbl></hp:run></hp:p>'
    )
    body = (
        f'<?xml version="1.0" encoding="UTF-8"?><hs:sec {ns}>'
        + p("제1조(목적) 이 기준은 조명기기의 효율 기준을 정한다.")
        + p("제2조(대기전력) 조명기기의 대기전력은 다음 표에 따른다.")
        + table
        + p("제3조(표시)<hp:tab/>제품에는 효율등급을 표시하여야 한다.")
        + "</hs:sec>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("mimetype", "application/hwp+zip")
        zf.writestr("Contents/section0.xml", body)
    path.write_bytes(buf.getvalue())


def main() -> None:
    kr_docx(OUT / "kr_notice_old.docx", "0.75 mA", False, "60 K", "2025년 1월 1일")
    kr_docx(OUT / "kr_notice_new.docx", "0.5 mA", True, "50 K", "2027년 7월 1일")
    eu_pdf(OUT / "eu_battery_old.pdf", "0.0005 %", "18 August 2026")
    eu_pdf(OUT / "eu_battery_new.pdf", "0.0001 %", "18 February 2027")
    eu_pdf(OUT / "eu_reflow_new.pdf", "0.0005 %", "18 August 2026", insert_phrase=True)
    hwpx_nested(OUT / "kr_lighting_nested_old.hwpx", "0.5 W 이하")
    hwpx_nested(OUT / "kr_lighting_nested_new.hwpx", "0.3 W 이하")
    (OUT / "multi_paragraph_old.txt").write_text(
        "제1조(목적) 이 기준은 시험용이다.\n\n"
        "제2조(절연저항) 절연저항은 다음과 같이 측정한다.\n\n"
        "1. 시험전압은 500 V로 한다.\n\n"
        "2. 측정값은 2 MΩ 이상이어야 한다.\n\n"
        "부칙\n\n"
        "이 기준은 공포한 날부터 시행한다.\n",
        encoding="utf-8",
    )
    (OUT / "multi_paragraph_new.txt").write_text(
        "제1조(목적) 이 기준은 시험용이다.\n\n"
        "제2조(절연저항) 절연저항은 다음과 같이 측정한다.\n\n"
        "1. 시험전압은 500 V로 한다.\n\n"
        "2. 측정값은 5 MΩ 이상이어야 한다.\n\n"
        "부칙\n\n"
        "이 기준은 공포한 날부터 시행한다.\n",
        encoding="utf-8",
    )
    print("generated in", OUT)


if __name__ == "__main__":
    main()
