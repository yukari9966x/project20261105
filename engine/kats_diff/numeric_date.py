"""수치·단위·부등호·표준번호·시행일/유예기한 정밀 비교 도메인 모듈 ([H2-4], T5, T6, T7)."""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Dict, List, Optional, Tuple

from .schemas import DateDelta, NumericDelta, NumericFact

# ---------------------------------------------------------------------------
# 1. 표준번호·조항번호·날짜 마스킹 (T6: 표준번호의 연도를 측정허용치로 추출하지 않음)
# ---------------------------------------------------------------------------
STANDARD_CITATION_RE = re.compile(
    r"\b(?:"
    r"(?:KS\s+[A-Z]\s+)?(?:IEC|ISO|EN|UL|CISPR|IEEE|ASTM|ITU|SAE)\s*[0-9]+(?:[\-:\/][0-9A-Za-z]+)*(?:\s*[:\-]\s*(?:19|20)\d{2})?"
    r"|KS\s+[A-Z]\s+[0-9]{3,5}(?:[\-:][0-9]{1,4})*"
    r"|제\s*(?:19|20)\d{2}\s*-\s*\d+\s*호"
    r")(?![0-9A-Za-z])",  # 뒤에 조사(에·을 등)가 붙어도 판본 연도까지 인식 (\b 는 한글 앞에서 끊기지 않음)
    re.IGNORECASE,
)

DATE_TOKEN_RE = re.compile(
    r"(?:"
    r"(?:19|20)\d{2}\s*[년.\-/]\s*\d{1,2}\s*[월.\-/]\s*\d{1,2}\s*일?"
    r"|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+(?:19|20)\d{2}"
    r")",
    re.IGNORECASE,
)

CLAUSE_REF_TOKEN_RE = re.compile(
    r"(?:"
    r"제\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?"
    r"|(?:Clause|Article|Section|Annex|Table|표|별표)\s*[A-Z0-9]+(?:\.\d+)*"
    r")",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# 2. 단위 변환 화이트리스트 (대소문자 구분: mW ≠ MW, mΩ ≠ MΩ)
#    같은 물리량 안에서만 환산한다. 온도(°C)와 온도차(K)는 서로 환산하지 않는다.
# ---------------------------------------------------------------------------
_D = Decimal
UNIT_WHITELIST: Dict[str, Tuple[str, str, Decimal]] = {
    # 길이 -> m
    "nm": ("length", "m", _D("0.000000001")),
    "μm": ("length", "m", _D("0.000001")),
    "µm": ("length", "m", _D("0.000001")),
    "um": ("length", "m", _D("0.000001")),
    "mm": ("length", "m", _D("0.001")),
    "cm": ("length", "m", _D("0.01")),
    "m": ("length", "m", _D("1")),
    "km": ("length", "m", _D("1000")),
    # 전류 -> A
    "μA": ("current", "A", _D("0.000001")),
    "µA": ("current", "A", _D("0.000001")),
    "uA": ("current", "A", _D("0.000001")),
    "mA": ("current", "A", _D("0.001")),
    "A": ("current", "A", _D("1")),
    "kA": ("current", "A", _D("1000")),
    # 전압 -> V
    "mV": ("voltage", "V", _D("0.001")),
    "V": ("voltage", "V", _D("1")),
    "kV": ("voltage", "V", _D("1000")),
    # 시간 -> s
    "ms": ("time", "s", _D("0.001")),
    "s": ("time", "s", _D("1")),
    "sec": ("time", "s", _D("1")),
    "초": ("time", "s", _D("1")),
    "min": ("time", "s", _D("60")),
    "분": ("time", "s", _D("60")),
    # 전력 -> W
    "mW": ("power", "W", _D("0.001")),
    "W": ("power", "W", _D("1")),
    "kW": ("power", "W", _D("1000")),
    "KW": ("power", "W", _D("1000")),
    "MW": ("power", "W", _D("1000000")),
    # 에너지 -> Wh, 전하량 -> Ah
    "mWh": ("energy", "Wh", _D("0.001")),
    "Wh": ("energy", "Wh", _D("1")),
    "kWh": ("energy", "Wh", _D("1000")),
    "mAh": ("charge", "Ah", _D("0.001")),
    "Ah": ("charge", "Ah", _D("1")),
    # 주파수 -> Hz
    "Hz": ("frequency", "Hz", _D("1")),
    "kHz": ("frequency", "Hz", _D("1000")),
    "MHz": ("frequency", "Hz", _D("1000000")),
    "GHz": ("frequency", "Hz", _D("1000000000")),
    # 질량 -> g
    "mg": ("mass", "g", _D("0.001")),
    "g": ("mass", "g", _D("1")),
    "kg": ("mass", "g", _D("1000")),
    # 함량(질량분율) -> ppm  (1 % = 10,000 ppm, 1 mg/kg = 1 ppm)
    "%": ("content", "ppm", _D("10000")),
    "ppm": ("content", "ppm", _D("1")),
    "mg/kg": ("content", "ppm", _D("1")),
    "ppb": ("content", "ppm", _D("0.001")),
    # 저항 -> Ω
    "mΩ": ("resistance", "Ω", _D("0.001")),
    "Ω": ("resistance", "Ω", _D("1")),
    "kΩ": ("resistance", "Ω", _D("1000")),
    "MΩ": ("resistance", "Ω", _D("1000000")),
    # 압력 -> Pa
    "Pa": ("pressure", "Pa", _D("1")),
    "kPa": ("pressure", "Pa", _D("1000")),
    "MPa": ("pressure", "Pa", _D("1000000")),
    "bar": ("pressure", "Pa", _D("100000")),
    # 온도·온도차 (서로 환산하지 않음)
    "°C": ("temperature", "°C", _D("1")),
    "℃": ("temperature", "°C", _D("1")),
    "K": ("temperature_rise", "K", _D("1")),
    # 같은 단위끼리만 비교 (환산 없음)
    "dB(A)": ("sound_level", "dB(A)", _D("1")),
    "dBA": ("sound_level", "dB(A)", _D("1")),
    "dB": ("decibel", "dB", _D("1")),
    "dBμV": ("emission_level", "dBμV", _D("1")),
    "dBμV/m": ("field_strength", "dBμV/m", _D("1")),
    "lx": ("illuminance", "lx", _D("1")),
    "lm/W": ("efficacy", "lm/W", _D("1")),
    "Wh/kg": ("energy_density", "Wh/kg", _D("1")),
}

# 아직 비교 규칙이 없는 단위 (원문 보존 + 담당자 검토)
UNSUPPORTED_UNITS: Dict[str, str] = {
    "%RH": "humidity",
    "%rh": "humidity",
}

# 정규식 대안은 앞에서부터 시도되므로 긴 단위를 먼저 둔다 (mAh 가 mA 보다, kWh 가 kW 보다 먼저)
_UNIT_ALTS = sorted(set(UNIT_WHITELIST) | set(UNSUPPORTED_UNITS), key=len, reverse=True)
ALL_UNIT_PATTERN = "(?:" + "|".join(re.escape(u) for u in _UNIT_ALTS) + ")"

QUANTITY_RE = re.compile(
    r"(?P<op_pre>(?:(?:shall\s+)?not\s+exceed(?:ing)?|no\s+more\s+than|not\s+more\s+than|no\s+less\s+than|not\s+less\s+than"
    r"|at\s+most|up\s+to|maximum(?:\s+of)?|max\.?|less\s+than|under|below|at\s+least|minimum(?:\s+of)?|min\.?"
    r"|greater\s+than|more\s+than|exceeding|above|최대|최소|[≤≥<>]=?)\s*)?"
    r"(?P<val>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)"
    r"\s*"
    r"(?P<unit>(?-i:" + ALL_UNIT_PATTERN + r"))(?![A-Za-z])"
    r"(?:\s*(?P<op_post>이하|미만|이상|초과|이내))?",
    re.IGNORECASE,
)

_NEGATION_BEFORE_RE = re.compile(r"(?:\bnot\b|\bno\b|n't|\bnever\b)[^.;,]{0,40}$", re.IGNORECASE)
_TABLE_UPPER_RE = re.compile(r"한계|최대|상한|허용치|\bmax|\blimit", re.IGNORECASE)
_TABLE_LOWER_RE = re.compile(r"최소|하한|\bmin", re.IGNORECASE)


def extract_standard_citations(text: str) -> List[str]:
    return [m.group(0).strip() for m in STANDARD_CITATION_RE.finditer(text)]


def _parse_operator(op_pre: str, op_post: str, sentence: str, prefix_ctx: str = "") -> Tuple[str, str]:
    """수치 앞뒤의 부등호·한정어로 상한/하한을 판정한다.

    'shall not contain more than 0.1 %' 처럼 앞쪽에 부정어가 있는 'more than'은 상한(이하)이다.
    """
    pre = (op_pre or "").strip().lower()
    post = (op_post or "").strip()
    negated = bool(_NEGATION_BEFORE_RE.search(prefix_ctx or ""))
    if pre.startswith(("no more than", "not more than")) or (negated and ("more than" in pre or "greater than" in pre)):
        return "le", "이하(" + ("" if pre.startswith(("no ", "not ")) else "not ") + op_pre.strip() + ")"
    if pre.startswith(("no less than", "not less than")) or (negated and ("less than" in pre or "fewer than" in pre)):
        return "ge", "이상(" + ("" if pre.startswith(("no ", "not ")) else "not ") + op_pre.strip() + ")"
    if post == "이하" or pre in ("<=", "≤") or "not exceed" in pre or "at most" in pre or "up to" in pre or "max" in pre or pre == "최대":
        return "le", post or op_pre.strip() or "이하"
    if post == "이내":
        return "le", "이내"
    if post == "미만" or pre == "<" or "less than" in pre or "under" in pre or "below" in pre:
        return "lt", post or op_pre.strip() or "미만"
    if post == "이상" or pre in (">=", "≥") or "at least" in pre or "min" in pre or pre == "최소":
        return "ge", post or op_pre.strip() or "이상"
    if post == "초과" or pre == ">" or "greater than" in pre or "more than" in pre or "exceeding" in pre or "above" in pre:
        return "gt", post or op_pre.strip() or "초과"
    # 문장 내 인접 키워드 보조 확인
    s_low = sentence.lower()
    if "not exceed" in s_low or "이하" in s_low:
        return "le", "이하/상한"
    if "미만" in s_low or "less than" in s_low:
        return "lt", "미만"
    if "이상" in s_low or "at least" in s_low:
        return "ge", "이상/하한"
    if "초과" in s_low or "greater than" in s_low:
        return "gt", "초과"
    # 표 행: 열 머리글이 '한계·최대·상한'이면 상한, '최소·하한'이면 하한으로 본다
    if sentence.lstrip().startswith("[표"):
        if _TABLE_UPPER_RE.search(sentence):
            return "le", "상한(표 머리글)"
        if _TABLE_LOWER_RE.search(sentence):
            return "ge", "하한(표 머리글)"
    return "eq", "="


def _extract_conditions_from_sentence(sentence: str) -> str:
    """문장 내 시험조건·온습도·부하 조건을 추출하여 비교 시 조건 일치 여부를 검증한다 (T5)."""
    cond_markers: List[str] = []
    # 온도 조건 (예: 25°C, 40°C, 상온, 고온)
    for m in re.finditer(r"(?:상온|고온|저온|\d+(?:\.\d+)?\s*(?:°C|℃))", sentence):
        cond_markers.append(m.group(0).replace(" ", ""))
    # 습도 조건 (예: 90% RH, 고습, 건조)
    for m in re.finditer(r"(?:고습|상습|\d+(?:\.\d+)?\s*%\s*RH)", sentence, re.IGNORECASE):
        cond_markers.append(m.group(0).replace(" ", "").upper())
    # 부하/작동 조건 (정격부하, 최대부하, 정상작동, 단일고장, 무부하, 과충전 등)
    for kw in (
        "정격부하",
        "최대부하",
        "무부하",
        "정상작동",
        "단일고장",
        "과충전",
        "단락시험",
        "normal load",
        "maximum load",
        "rated load",
        "single fault",
        "elevated temperature",
        "room temperature",
    ):
        if kw.lower() in sentence.lower():
            cond_markers.append(kw.lower())
    return ", ".join(sorted(set(cond_markers)))


def _extract_subject_from_sentence(sentence: str, match_start: int) -> str:
    """수치 앞부분의 측정 대상 항목(예: 누설전류, 연면거리, 절연저항, 대기전력 등)을 추출한다."""
    known_subjects = [
        ("누설전류", "leakage_current"),
        ("leakage current", "leakage_current"),
        ("연면거리", "creepage_distance"),
        ("creepage distance", "creepage_distance"),
        ("공간거리", "clearance_distance"),
        ("clearance", "clearance_distance"),
        ("소비전력", "power_consumption"),
        ("정격전력", "rated_power"),
        ("대기전력", "standby_power"),
        ("standby power", "standby_power"),
        ("차단시간", "cutoff_time"),
        ("응답시간", "response_time"),
        ("response time", "response_time"),
        ("trip time", "cutoff_time"),
        ("리플전압", "ripple_voltage"),
        ("인출전압", "output_voltage"),
        ("과충전 차단전압", "overcharge_voltage"),
        ("시험전압", "test_voltage"),
        ("절연저항", "insulation_resistance"),
        ("표면온도", "surface_temperature"),
        ("최고온도", "max_temperature"),
        ("max temperature", "max_temperature"),
    ]
    s_low = sentence.lower()
    for label, canonical_subj in known_subjects:
        if label in s_low:
            return canonical_subj
    prefix = sentence[:match_start].strip()
    words = re.findall(r"[가-힣A-Za-z0-9_]+", prefix)
    return "_".join(words[-2:]).lower() if words else "general_parameter"


def detect_modality(sentence: str) -> str:
    s_low = sentence.lower()
    if (
        "shall not" in s_low
        or "must not" in s_low
        or "아니한다" in s_low
        or "금지한다" in s_low
        or "할 수 없다" in s_low
        or "불가하다" in s_low
    ):
        return "prohibition"
    if "may " in s_low or "수 있다" in s_low or "권장한다" in s_low:
        return "optional"
    return "mandatory"


def extract_numeric_facts(text: str, evidence_ids: Optional[List[str]] = None) -> List[NumericFact]:
    """조항 본문에서 표준번호/날짜/조항번호를 먼저 마스킹한 뒤 Decimal 기반으로 측정 수치를 추출한다."""
    ev_list = list(evidence_ids or [])
    facts: List[NumericFact] = []

    # 문장 단위 분할. 표 행("[표1 행2] [열] 값 | [열] 값")은 칸(셀)별로 나눠, 한 칸의 '이상/이하'가
    # 옆 칸 수치에 잘못 적용되지 않게 한다 (각 칸에는 자기 열 머리글이 붙어 있음).
    sentences: List[str] = []
    for line in re.split(r"[\n]", text):
        if line.lstrip().startswith("[표") and " | " in line:
            head = re.match(r"\s*(\[표\d+\s*행\d+\])", line)
            prefix = head.group(1) + " " if head else ""
            cells = line[head.end():].split(" | ") if head else line.split(" | ")
            sentences.extend(prefix + c.strip() for c in cells if c.strip())
        else:
            sentences.extend(s.strip() for s in re.split(r"(?<=[.다])\s+", line) if s.strip())
    for sent in sentences:
        # 표준번호, 날짜, 조항번호를 동일 길이 공백/플레이스홀더로 마스킹 (T6)
        masked = STANDARD_CITATION_RE.sub(lambda m: "_" * len(m.group(0)), sent)
        masked = DATE_TOKEN_RE.sub(lambda m: "_" * len(m.group(0)), masked)
        masked = CLAUSE_REF_TOKEN_RE.sub(lambda m: "_" * len(m.group(0)), masked)

        cond_str = _extract_conditions_from_sentence(sent)
        modality = detect_modality(sent)

        for m in QUANTITY_RE.finditer(masked):
            raw_val_str = m.group("val")
            if re.fullmatch(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", raw_val_str):
                raw_val_str = raw_val_str.replace(",", "")  # 천 단위 구분 쉼표 (1,500 W)
            else:
                raw_val_str = raw_val_str.replace(",", ".")  # 소수점 쉼표 (0,5 mA)
            raw_unit_str = m.group("unit")
            op_pre = m.group("op_pre") or ""
            op_post = m.group("op_post") or ""

            # 만약 이 수치+단위 자체가 온도 조건(예: "25°C에서 누설전류는 0.75mA 이하")의 부수 조건이고
            # 같은 문장에 주 측정값(전류/길이/전력/전압/시간)이 있다면 조건용 온도는 제외
            unit_key = raw_unit_str
            if unit_key in ("°C", "℃", "%RH", "%rh") and any(
                 kw in sent[max(0, m.start() - 10) : m.end() + 20]
                 for kw in ("상온", "고온", "저온", "고습", "에서", "조건", "at ", "under ", "(")
            ):
                continue

            try:
                dec_val = Decimal(raw_val_str)
            except InvalidOperation:
                continue

            op_code, op_raw = _parse_operator(op_pre, op_post, sent, masked[max(0, m.start() - 60) : m.start()])
            subj = _extract_subject_from_sentence(sent, m.start())

            if unit_key in UNIT_WHITELIST:
                q_kind, canon_unit, factor = UNIT_WHITELIST[unit_key]
                if unit_key == "K" and dec_val >= 1000:
                    q_kind = "color_temperature"  # 3000K~5000K 등 색온도는 온도상승(K)과 구분
                canon_dec = (dec_val * factor).normalize()
                facts.append(
                    NumericFact(
                        raw_value=raw_val_str,
                        decimal_value=str(dec_val),
                        raw_unit=raw_unit_str,
                        canonical_unit=canon_unit,
                        canonical_decimal=format(canon_dec, "f"),
                        operator=op_code,
                        operator_raw=op_raw,
                        quantity_kind=q_kind,
                        subject=subj,
                        test_method="",
                        conditions=cond_str,
                        modality=modality,
                        evidence_ids=ev_list,
                        parse_status="parsed",
                    )
                )
            else:
                q_kind = UNSUPPORTED_UNITS.get(unit_key, "unsupported")
                facts.append(
                    NumericFact(
                        raw_value=raw_val_str,
                        decimal_value=str(dec_val),
                        raw_unit=raw_unit_str,
                        canonical_unit=None,
                        canonical_decimal=None,
                        operator=op_code,
                        operator_raw=op_raw,
                        quantity_kind=q_kind,
                        subject=subj,
                        test_method="",
                        conditions=cond_str,
                        modality=modality,
                        evidence_ids=ev_list,
                        parse_status="review_required",
                    )
                )

    return facts


def compare_numeric_facts(
    old_facts: List[NumericFact], new_facts: List[NumericFact]
) -> List[NumericDelta]:
    """구판과 신판의 NumericFact 목록을 비교하여 동등/강화/완화/경계변경/조건검토를 판정한다 ([H2-4], T5)."""
    deltas: List[NumericDelta] = []
    used_new_indices = set()

    for of in old_facts:
        # 동일 물리량(quantity_kind) 및 유사 항목(subject) 매칭
        best_idx: Optional[int] = None
        for idx, nf in enumerate(new_facts):
            if idx in used_new_indices:
                continue
            if of.quantity_kind == nf.quantity_kind and of.subject == nf.subject:
                best_idx = idx
                break
        if best_idx is None:
            for idx, nf in enumerate(new_facts):
                if idx in used_new_indices:
                    continue
                if of.quantity_kind == nf.quantity_kind:
                    best_idx = idx
                    break

        if best_idx is None:
            continue

        used_new_indices.add(best_idx)
        nf = new_facts[best_idx]

        # 1. 지원하지 않는 단위(온도/비율/복합단위 등)는 원문 보존 + 검토 필요 ([H2-4])
        if of.parse_status != "parsed" or nf.parse_status != "parsed" or not of.canonical_unit or not nf.canonical_unit:
            deltas.append(
                NumericDelta(
                    subject=of.subject,
                    quantity_kind=of.quantity_kind,
                    old_fact=of,
                    new_fact=nf,
                    status="unit_unsupported_review",
                    summary_ko=f"{of.raw_value}{of.raw_unit} → {nf.raw_value}{nf.raw_unit} (비환산 단위 — 담당자 검토 필요)",
                    calculable=False,
                    reason_ko="P0 단위 변환 화이트리스트 외 단위(온도·비율·복합단위 등)이므로 원문을 보존하고 수동 검토로 분류함",
                )
            )
            continue

        # 2. 시험조건·부하조건이 다르면 수치 동등/강화/완화로 단정하지 않고 검토 필요 표시 (T5)
        if of.conditions != nf.conditions and (of.conditions or nf.conditions):
            deltas.append(
                NumericDelta(
                    subject=of.subject,
                    quantity_kind=of.quantity_kind,
                    old_fact=of,
                    new_fact=nf,
                    status="condition_changed_review",
                    summary_ko=(
                        f"{of.raw_value}{of.raw_unit} ({of.conditions or '조건 미기재'}) → "
                        f"{nf.raw_value}{nf.raw_unit} ({nf.conditions or '조건 미기재'}): "
                        "수치 변경, 강화 여부 검토 (시험·부하 조건 상이)"
                    ),
                    calculable=False,
                    reason_ko=f"구판 조건({of.conditions or '기본'})과 신판 조건({nf.conditions or '기본'})이 달라 단순 수치 비교 불가",
                )
            )
            continue

        old_dec = Decimal(of.canonical_decimal)
        new_dec = Decimal(nf.canonical_decimal)

        # 3. 정규화 수치가 동일한 경우 (예: 500mA == 0.5A, 또는 10mm 이하 -> 10mm 미만)
        if old_dec == new_dec:
            if of.operator == nf.operator:
                deltas.append(
                    NumericDelta(
                        subject=of.subject,
                        quantity_kind=of.quantity_kind,
                        old_fact=of,
                        new_fact=nf,
                        status="numeric_equivalent",
                        summary_ko=(
                            f"수치 동등 ({of.raw_value}{of.raw_unit} = {nf.raw_value}{nf.raw_unit}, "
                            f"표준환산 {of.canonical_decimal}{of.canonical_unit})"
                        ),
                        calculable=True,
                        reason_ko="동일 차원·물리량·조건에서 단위 환산 결과 수치가 완전히 동일함",
                    )
                )
            else:
                deltas.append(
                    NumericDelta(
                        subject=of.subject,
                        quantity_kind=of.quantity_kind,
                        old_fact=of,
                        new_fact=nf,
                        status="boundary_changed",
                        summary_ko=(
                            f"부등호 경계 변경 ({of.raw_value}{of.raw_unit} {of.operator_raw} → "
                            f"{nf.raw_value}{nf.raw_unit} {nf.operator_raw})"
                        ),
                        calculable=True,
                        reason_ko=f"수치는 동일하나 경계 연산자가 {of.operator}({of.operator_raw})에서 {nf.operator}({nf.operator_raw})로 변경됨",
                    )
                )
            continue

        # 4. 수치가 변경된 경우: 상한(le/lt)과 하한(ge/gt)을 구분하여 강화/완화 판정 ([H2-4], T5)
        if of.operator in ("le", "lt") and nf.operator in ("le", "lt"):
            if new_dec < old_dec:
                status = "tightened"
                direction_ko = "강화 (허용 상한 축소)"
            else:
                status = "relaxed"
                direction_ko = "완화 (허용 상한 확대)"
            deltas.append(
                NumericDelta(
                    subject=of.subject,
                    quantity_kind=of.quantity_kind,
                    old_fact=of,
                    new_fact=nf,
                    status=status,
                    summary_ko=f"{of.raw_value}{of.raw_unit} {of.operator_raw} → {nf.raw_value}{nf.raw_unit} {nf.operator_raw} [{direction_ko}]",
                    calculable=True,
                    reason_ko=f"동일 대상·조건의 상한 허용치가 표준환산 {old_dec}{of.canonical_unit}에서 {new_dec}{nf.canonical_unit}로 변경됨",
                )
            )
        elif of.operator in ("ge", "gt") and nf.operator in ("ge", "gt"):
            # 하한(최소 연면거리, 최소 절연두께 등)은 값이 커지면 강화, 작아지면 완화!
            if new_dec > old_dec:
                status = "tightened"
                direction_ko = "강화 (최소 요구 하한 상향)"
            else:
                status = "relaxed"
                direction_ko = "완화 (최소 요구 하한 하향)"
            deltas.append(
                NumericDelta(
                    subject=of.subject,
                    quantity_kind=of.quantity_kind,
                    old_fact=of,
                    new_fact=nf,
                    status=status,
                    summary_ko=f"{of.raw_value}{of.raw_unit} {of.operator_raw} → {nf.raw_value}{nf.raw_unit} {nf.operator_raw} [{direction_ko}]",
                    calculable=True,
                    reason_ko=f"동일 대상·조건의 최소 요구 하한치가 표준환산 {old_dec}{of.canonical_unit}에서 {new_dec}{nf.canonical_unit}로 변경됨",
                )
            )
        else:
            deltas.append(
                NumericDelta(
                    subject=of.subject,
                    quantity_kind=of.quantity_kind,
                    old_fact=of,
                    new_fact=nf,
                    status="value_changed_review",
                    summary_ko=f"{of.raw_value}{of.raw_unit} → {nf.raw_value}{nf.raw_unit} (수치 변경, 강화 여부 검토)",
                    calculable=False,
                    reason_ko="상한/하한 연산자가 비대칭이거나 정격 기준값 변경이므로 강화/완화 자동 단정 보류",
                )
            )

    return deltas


# ---------------------------------------------------------------------------
# 3. 시행일·유예기간·제조일/수입일 기준 추출 및 검증 ([H2-4], T7)
# ---------------------------------------------------------------------------
ISO_DATE_NORM_RE = re.compile(
    r"(?P<y>(?:19|20)\d{2})\s*(?:년|[.\-/])\s*(?P<m>\d{1,2})\s*(?:월|[.\-/])\s*(?P<d>\d{1,2})\s*일?"
)

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9,
    "oct": 10, "nov": 11, "dec": 12,
}
_MONTH_RE = r"(?P<mon>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?"
DMY_DATE_RE = re.compile(r"\b(?P<d>\d{1,2})(?:st|nd|rd|th)?\s+" + _MONTH_RE + r",?\s+(?P<y>(?:19|20)\d{2})\b", re.IGNORECASE)  # 18 February 2027 (EU·영국)
MDY_DATE_RE = re.compile(r"\b" + _MONTH_RE + r"\s+(?P<d>\d{1,2})(?:st|nd|rd|th)?,?\s+(?P<y>(?:19|20)\d{2})\b", re.IGNORECASE)  # February 18, 2027 (미국)
CJK_DATE_RE = re.compile(r"(?P<y>(?:19|20)\d{2})\s*年\s*(?P<m>\d{1,2})\s*月\s*(?P<d>\d{1,2})\s*日")  # 2027年1月1日 (중국·일본)

RELATIVE_DATE_RE = re.compile(
    r"(?:공포\s*후|고시\s*후|발령\s*후|공포한\s*날부터|after\s+promulgation|after\s+publication)\s*(?P<num>\d+)\s*(?P<unit>개월|월|년|일|months?|years?|days?)"
    r"|(?P<num2>\d+)\s*(?P<unit2>months?|years?|days?)\s+(?:after|from|following)\s+(?:the\s+)?(?:date\s+of\s+)?(?:entry\s+into\s+force|publication|promulgation|adoption)"
    r"|(?:发布|公布|颁布)之日起\s*(?P<num3>\d+)\s*(?P<unit3>个月|年|日)",
    re.IGNORECASE,
)


def _find_dates(text: str) -> List[Tuple[str, str]]:
    """본문에서 날짜를 등장 순서대로 찾아 (원문 표기, YYYY-MM-DD)로 돌려준다.

    지원: 2027년 1월 1일 / 2027-01-01 / 2027.1.1 / 18 February 2027 / February 18, 2027 / 2027年1月1日
    (01/02/2027 처럼 일·월 순서가 모호한 표기는 오판 위험이 있어 인식하지 않는다)
    """
    found: List[Tuple[int, str, str]] = []
    for m in ISO_DATE_NORM_RE.finditer(text):
        found.append((m.start(), m.group(0), f"{int(m.group('y')):04d}-{int(m.group('m')):02d}-{int(m.group('d')):02d}"))
    for rx in (DMY_DATE_RE, MDY_DATE_RE):
        for m in rx.finditer(text):
            mon = _MONTHS.get(m.group("mon").lower()[:3])
            if mon:
                found.append((m.start(), m.group(0), f"{int(m.group('y')):04d}-{mon:02d}-{int(m.group('d')):02d}"))
    for m in CJK_DATE_RE.finditer(text):
        found.append((m.start(), m.group(0), f"{int(m.group('y')):04d}-{int(m.group('m')):02d}-{int(m.group('d')):02d}"))
    found.sort(key=lambda t: t[0])
    out: List[Tuple[str, str]] = []
    seen_pos = set()
    for pos, raw, iso in found:
        if pos in seen_pos:
            continue
        seen_pos.add(pos)
        out.append((raw, iso))
    return out


def _normalize_iso_date(raw_date: str) -> Optional[str]:
    hits = _find_dates(raw_date)
    return hits[0][1] if hits else None


def extract_and_compare_dates(old_text: str, new_text: str) -> List[DateDelta]:
    """구판/신판 조항에서 시행일, 유예종료일, 제조일/수입일 기준, 상대기한(공포 후 N개월)을 구분 추출한다 (T7)."""
    deltas: List[DateDelta] = []
    combined = f"{old_text}\n{new_text}"
    if not any(
        kw in combined.lower()
        for kw in (
            "시행",
            "유예",
            "경과조치",
            "제조일",
            "수입",
            "통관",
            "공포",
            "적용한다",
            "effective",
            "transition",
            "grace period",
            "manufactured",
            "imported",
            "enter into force",
            "enters into force",
            "shall apply",
            "apply from",
            "applies from",
            "by ",
            "no later than",
            "until",
            "deadline",
            "实施",
            "施行",
            "生效",
            "适用",
            "vigor",
        )
    ):
        return deltas

    old_dates = [raw for raw, _ in _find_dates(old_text)]
    new_dates = [raw for raw, _ in _find_dates(new_text)]

    # 기준 시점(제조일 vs 수입신고일/통관일) 판별
    basis_parts: List[str] = []
    role = "effective_date"
    if "제조일" in new_text or "제조된" in new_text or "manufactured" in new_text.lower():
        basis_parts.append("제조일 기준 적용")
        role = "manufacturing_date_basis"
    if "수입" in new_text or "통관" in new_text or "imported" in new_text.lower():
        basis_parts.append("수입신고일(통관일) 기준 적용")
        if role == "effective_date":
            role = "import_date_basis"
    if "유예" in new_text or "경과조치" in new_text or "기존" in new_text or "transition" in new_text.lower() or "grace" in new_text.lower():
        if len(new_dates) >= 2:
            # 시행일과 유예종료일이 모두 있는 경우 분리 등록
            eff_iso = _normalize_iso_date(new_dates[0])
            grace_iso = _normalize_iso_date(new_dates[1])
            old_iso = _normalize_iso_date(old_dates[0]) if old_dates else None
            deltas.append(
                DateDelta(
                    role="effective_date",
                    old_date_raw=old_iso or (old_dates[0] if old_dates else None),
                    new_date_raw=new_dates[0],
                    resolved_date=eff_iso,
                    status="confirmed" if eff_iso else "unconfirmed",
                    basis_note_ko="신판 시행일 명시 (" + (", ".join(basis_parts) if basis_parts else "일반 시행일") + ")",
                    calculable=bool(eff_iso),
                )
            )
            deltas.append(
                DateDelta(
                    role="grace_period_end",
                    old_date_raw=None,
                    new_date_raw=new_dates[1],
                    resolved_date=grace_iso,
                    status="confirmed" if grace_iso else "unconfirmed",
                    basis_note_ko="기존 인증/제조 모델 경과조치(유예종료일) 명시",
                    calculable=bool(grace_iso),
                )
            )
            return deltas
        role = "grace_period_end"

    # 상대 기한("공포 후 6개월" 등) 검사 ([H2-4], T7)
    rel_m = RELATIVE_DATE_RE.search(new_text)
    if rel_m and not new_dates:
        rel_expr = rel_m.group(0)
        deltas.append(
            DateDelta(
                role="relative_period",
                old_date_raw=_normalize_iso_date(old_dates[0]) if old_dates else None,
                new_date_raw=rel_expr,
                resolved_date=None,
                status="unconfirmed",
                basis_note_ko=(
                    f"'{rel_expr}' 상대 기한만 기재되어 있고 확정 공포일 및 월 말일 계산 근거가 "
                    "문서 내에 확인되지 않으므로 미확정(unconfirmed)으로 유지함"
                ),
                calculable=False,
            )
        )
        return deltas

    if new_dates:
        resolved = _normalize_iso_date(new_dates[0])
        old_iso = _normalize_iso_date(old_dates[0]) if old_dates else None
        deltas.append(
            DateDelta(
                role=role,
                old_date_raw=old_iso,
                new_date_raw=new_dates[0],
                resolved_date=resolved,
                status="confirmed" if resolved else "unconfirmed",
                basis_note_ko=", ".join(basis_parts) if basis_parts else "시행일/적용기한 명시 확인",
                calculable=bool(resolved),
            )
        )

    return deltas
