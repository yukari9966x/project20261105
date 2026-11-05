"""문서 구조 인식용 공통 정규식 (파서·조항분할기 공용).

- CLAUSE_HEADER_RE : 조항(조문) 머리 — 새 조항의 시작
- HEADING_ONLY_RE  : 장·절·부칙·별표·부속서 같은 상위 제목 — 조항 묶음의 경계
- LIST_ITEM_RE     : 항·호·목(①, 1., (a), 가.) 같은 하위 항목 — 직전 조항에 귀속
- PAGE_NOISE_RE    : PDF 쪽번호·머리말 같은 잡음 줄
"""
from __future__ import annotations

import re

# 숫자형 조항번호(2.1, A.1.2) 바로 뒤에 단위가 오면 조항 머리가 아니라 측정값이다 (예: "0.5 mA 이하").
_UNIT_AFTER_NUMBER = (
    r"(?=\s|$|[(:\-–—])"  # 번호 바로 뒤에 글자가 붙어 있으면(1.06배에서) 조항 머리가 아님
    r"(?!\s*(?-i:%|‰|ppm|ppb|mA|kA|A\b|mV|kV|V\b|mW|W\b|kW|MW|Hz|kHz|MHz|GHz|mm|cm|m\b|km|ms|s\b|K\b|°|℃"
    r"|dB|lx|lm|cd|mg|kg|g\b|Ω|kΩ|MΩ|Pa|kPa|MPa|bar|Wh|kWh|mAh|Ah|μ|um|nm"
    r"|(?:배|개월|년|일|시간|분|초)(?![가-힣])))"  # 단위는 대소문자를 구분해 판정 (mA ≠ Marking)
)

_CJK_NUM = r"[0-9０-９一二三四五六七八九十百千零〇两]+"

CLAUSE_HEADER_RE = re.compile(
    r"^(?P<num>"
    r"제\s*\d+\s*조(?:\s*의\s*\d+)?"
    r"|(?:Clause|Article|Section)\s+\d+(?:\.\d+)*[A-Za-z]?"
    r"|第\s*" + _CJK_NUM + r"\s*[条條](?:之" + _CJK_NUM + r")?"  # 중국·대만·일본: 第十二条, 第5條
    r"|(?:Artículo|Articulo|Artigo|Artikel|Art\.)\s*\d+(?:\.\d+)*[A-Za-z]?º?"  # 스페인·포르투갈·독일어권
    r"|§\s*\d+[a-z]?"  # 독일·오스트리아 등 조문 기호
    r"|المادة\s*\(?\d+\)?"  # 아랍어(사우디 등) '제n조'

    # 숫자형 번호는 끝까지 읽은 뒤(뒤에 숫자·점이 더 붙지 않음) 단위가 따라오지 않을 때만 조항 머리로 본다
    r"|(?:[A-Z]\.)?[1-9]\d{0,2}(?:\.\d{1,3})+\.?(?![\d.])" + _UNIT_AFTER_NUMBER +
    r"|부칙\s*제\s*\d+\s*조"
    r")"
    r"(?:\s*\((?P<paren_title>[^)]+)\)|\s*[\-–—:]\s*(?P<dash_title>[^\n]+)|\s+(?P<inline_title>[가-힣A-Za-z][^\n]{1,60}))?",
    re.IGNORECASE,
)

HEADING_ONLY_RE = re.compile(
    r"^(?:#+\s*)?(?:제\s*\d+\s*[장절편]|부\s*칙(?!\s*제\s*\d+\s*조)|별\s*표\s*\d*(?!\s*제\s*\d+\s*조)|별\s*지\s*\d*|부\s*록\s*\d*"
    r"|CHAPTER\s+[0-9IVX]+|PART\s+[0-9IVX]+|SECTION\s+[0-9IVX]+|ANNEX\s+[A-Z0-9]+|APPENDIX\s+[A-Z0-9]+|SCHEDULE\s+[0-9IVX]+"
    r"|第\s*" + _CJK_NUM + r"\s*[章节節编編部]|附\s*[件录錄]\s*(?:" + _CJK_NUM + r")?"
    r"|CAP[ÍI]TULO\s+[0-9IVX]+|ANEXO\s+[A-Z0-9IVX]+|KAPITEL\s+[0-9IVX]+|ANHANG\s+[A-Z0-9IVX]+|الفصل\s*\S+|الباب\s*\S+)"
    r"(?:\s*[:\-–—.]?\s*[^\n]*)?$",
    re.IGNORECASE,
)

# 항(①), 호(1. / 1) / (1)), 목(가. / (가)), 영문 (a) / (i), 글머리표
LIST_ITEM_RE = re.compile(
    r"^(?:[①-⑳㉑-㉟]"  # ①~⑳, ㉑~㉟
    r"|\(?\d{1,3}[.)](?=\s)"
    r"|\(\d{1,3}\)"
    r"|\(?[a-z][.)](?=\s)"
    r"|\((?:[ivx]{1,5}|[a-z])\)"
    r"|[가-하][.)](?=\s)"
    r"|\([가-하]\)"
    r"|[•·▪◦■□○●\-–](?=\s)"
    r"|[（(][一二三四五六七八九十]+[）)]|[一二三四五六七八九十]+、)"  # 중국어 항·목: （一）, 一、
)

# PDF 쪽번호·쪽 표기 줄 (예: "- 3 -", "Page 3 of 10", "3 / 10", "12")
PAGE_NOISE_RE = re.compile(
    r"^\s*(?:[-–]\s*)?\d{1,4}(?:\s*[-–])?\s*$"
    r"|^\s*(?:page|p\.)\s*\d{1,4}(?:\s*(?:of|/)\s*\d{1,4})?\s*$"
    r"|^\s*\d{1,4}\s*/\s*\d{1,4}\s*$",
    re.IGNORECASE,
)

# 파서가 상위 제목(heading_path)으로 기억할 줄
HEADING_PREFIX_RE = re.compile(
    r"^(#+\s+|제\s*\d+\s*장|제\s*\d+\s*절|부칙|별표\s*\d*|별지\s*\d*|부록\s*\d*"
    r"|CHAPTER\s+[0-9IVX]+|PART\s+[0-9IVX]+|ANNEX\s+[A-Z0-9]+|APPENDIX\s+[A-Z0-9]+|SCHEDULE\s+[0-9IVX]+"
    r"|第\s*" + _CJK_NUM + r"\s*[章节節编編部]|附\s*[件录錄]|CAP[ÍI]TULO\s+|ANEXO\s+|KAPITEL\s+|ANHANG\s+|الفصل|الباب)",
    re.IGNORECASE,
)
