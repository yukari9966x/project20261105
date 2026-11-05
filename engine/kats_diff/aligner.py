"""조항 정렬 엔진(DeterministicAligner, CandidateBuilder, SemanticAligner, AlignmentValidator) ([H2-3])."""
from __future__ import annotations

import hashlib
import re
import uuid
from typing import Any, Counter as CounterType, Dict, List, Optional, Set, Tuple
from collections import Counter

from .segmenter import strip_clause_prefix
from .schemas import Alignment, Clause, Coverage, Document, Evidence, Segment
from .verifier import create_and_verify_evidence
from .parser import normalize_with_map


def _alnum_hangul_only(text: str) -> str:
    """서식(문장부호·공백·글머리표)만 다른 조항을 식별하기 위해 한글·영문·숫자·부등호만 남긴 문자열을 반환한다."""
    return re.sub(r"[^0-9A-Za-z가-힣<>≤≥±.%°/]", "", text).lower()


def char_ngram_similarity(a: str, b: str, n: int = 3) -> float:
    """영문/한글 문자 n-gram 코사인/자카드 유사도 계산 ([H2-1])."""
    sa = re.sub(r"\s+", " ", a.strip().lower())
    sb = re.sub(r"\s+", " ", b.strip().lower())
    if not sa or not sb:
        return 0.0
    if sa == sb:
        return 1.0
    if len(sa) < n or len(sb) < n:
        return 1.0 if sa == sb else 0.0

    grams_a = Counter(sa[i : i + n] for i in range(len(sa) - n + 1))
    grams_b = Counter(sb[i : i + n] for i in range(len(sb) - n + 1))
    intersection = sum((grams_a & grams_b).values())
    union = sum((grams_a | grams_b).values())
    return intersection / union if union > 0 else 0.0


def token_overlap_similarity(a: str, b: str) -> float:
    toks_a = set(re.findall(r"[가-힣]{2,}|[A-Za-z]{2,}|\d+(?:\.\d+)?", a.lower()))
    toks_b = set(re.findall(r"[가-힣]{2,}|[A-Za-z]{2,}|\d+(?:\.\d+)?", b.lower()))
    if not toks_a or not toks_b:
        return 0.0
    return len(toks_a & toks_b) / len(toks_a | toks_b)


def combined_clause_similarity(old_cl: Clause, new_cl: Clause) -> float:
    """조항 본문(번호 제거 후), 제목 경로, 토큰 중첩을 결합한 유사도 점수."""
    old_body = strip_clause_prefix(old_cl.text)
    new_body = strip_clause_prefix(new_cl.text)
    ngram3 = char_ngram_similarity(old_body, new_body, n=3)
    ngram2 = char_ngram_similarity(old_body, new_body, n=2)
    tok_sim = token_overlap_similarity(old_body, new_body)

    base_sim = 0.45 * ngram3 + 0.30 * ngram2 + 0.25 * tok_sim

    # 상위 장/부속서 제목(heading_path)이 둘 다 존재하는데 서로 다른 장/부속서이고 조항 번호만 같은 경우 감점
    if old_cl.heading_path and new_cl.heading_path:
        h_sim = token_overlap_similarity(old_cl.heading_path, new_cl.heading_path)
        if h_sim == 0.0 and old_cl.clause_number == new_cl.clause_number:
            # 예: 제2장 3.1 vs Annex A 3.1 (반복 번호 오매칭 방지)
            base_sim *= 0.65
        elif h_sim > 0.5:
            base_sim = min(1.0, base_sim + 0.05)

    return round(base_sim, 4)


def _extract_short_quote(clause: Clause, max_len: int = 120) -> str:
    line = clause.text.splitlines()[0].strip()
    return line[:max_len] if len(line) > max_len else line


def _build_alignment_evidences(
    old_clauses: List[Clause],
    new_clauses: List[Clause],
    old_doc: Document,
    new_doc: Document,
    old_segs_by_id: Dict[str, Segment],
    new_segs_by_id: Dict[str, Segment],
) -> Tuple[List[str], List[Evidence]]:
    ev_ids: List[str] = []
    ev_objs: List[Evidence] = []
    for ocl in old_clauses:
        if ocl.segment_ids:
            ev = create_and_verify_evidence(
                old_doc, old_segs_by_id, ocl.segment_ids[0], _extract_short_quote(ocl)
            )
            ev_ids.append(ev.id)
            ev_objs.append(ev)
    for ncl in new_clauses:
        if ncl.segment_ids:
            ev = create_and_verify_evidence(
                new_doc, new_segs_by_id, ncl.segment_ids[0], _extract_short_quote(ncl)
            )
            ev_ids.append(ev.id)
            ev_objs.append(ev)
    return ev_ids, ev_objs


# ---------------------------------------------------------------------------
# 성능 개선(A3): 조항별 특징(정규화 본문·n-gram·토큰)을 한 번만 계산해 재사용하고,
# 조항 쌍 유사도는 메모이제이션한다. 계산식은 combined_clause_similarity 와 동일하다.
# ---------------------------------------------------------------------------
_TOKEN_RE = re.compile(r"[가-힣]{2,}|[A-Za-z]{2,}|\d+(?:\.\d+)?")


class _TextFeat:
    __slots__ = ("norm", "g3", "g2", "n3", "n2", "toks")

    def __init__(self, body: str) -> None:
        self.norm = re.sub(r"\s+", " ", body.strip().lower())
        s = self.norm
        # zip 으로 n-gram을 만들면 C 수준에서 계수되어 문자열 슬라이싱보다 수 배 빠르다 (값은 동일)
        self.g3 = Counter(zip(s, s[1:], s[2:]))
        self.g2 = Counter(zip(s, s[1:]))
        self.n3 = sum(self.g3.values())
        self.n2 = sum(self.g2.values())
        self.toks = set(_TOKEN_RE.findall(body.lower()))


def _jaccard_counts(a: Counter, na: int, b: Counter, nb: int) -> float:
    common = a.keys() & b.keys()  # 공통 n-gram만 순회 (집합 연산은 C 수준)
    inter = 0
    for k in common:
        v = a[k]
        w = b[k]
        inter += v if v < w else w
    union = na + nb - inter
    return inter / union if union > 0 else 0.0


def _ngram_sim(fa: _TextFeat, fb: _TextFeat, n: int) -> float:
    if not fa.norm or not fb.norm:
        return 0.0
    if fa.norm == fb.norm:
        return 1.0
    if len(fa.norm) < n or len(fb.norm) < n:
        return 0.0
    if n == 3:
        return _jaccard_counts(fa.g3, fa.n3, fb.g3, fb.n3)
    return _jaccard_counts(fa.g2, fa.n2, fb.g2, fb.n2)


def _token_sim(ta: Set[str], tb: Set[str]) -> float:
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


class _SimilarityIndex:
    """조항 특징 캐시 + 쌍 유사도 메모이제이션."""

    def __init__(self) -> None:
        self._feat: Dict[str, _TextFeat] = {}
        self._head: Dict[str, Set[str]] = {}
        self._memo: Dict[Tuple[str, str], float] = {}

    def feat(self, cl: Clause) -> _TextFeat:
        f = self._feat.get(cl.id)
        if f is None:
            f = _TextFeat(strip_clause_prefix(cl.text))
            self._feat[cl.id] = f
        return f

    def head_toks(self, cl: Clause) -> Set[str]:
        if cl.id == "tmp":  # 분할·병합용 가상 조항은 캐시하지 않음
            return set(_TOKEN_RE.findall((cl.heading_path or "").lower()))
        h = self._head.get(cl.id)
        if h is None:
            h = set(_TOKEN_RE.findall((cl.heading_path or "").lower()))
            self._head[cl.id] = h
        return h

    def _score(self, o: Clause, fo: _TextFeat, n: Clause, fn: _TextFeat) -> float:
        base = 0.45 * _ngram_sim(fo, fn, 3) + 0.30 * _ngram_sim(fo, fn, 2) + 0.25 * _token_sim(fo.toks, fn.toks)
        if o.heading_path and n.heading_path:
            h_sim = _token_sim(self.head_toks(o), self.head_toks(n))
            if h_sim == 0.0 and o.clause_number == n.clause_number:
                base *= 0.65
            elif h_sim > 0.5:
                base = min(1.0, base + 0.05)
        return round(base, 4)

    def sim(self, o: Clause, n: Clause) -> float:
        key = (o.id, n.id)
        v = self._memo.get(key)
        if v is None:
            v = self._score(o, self.feat(o), n, self.feat(n))
            self._memo[key] = v
        return v

    def sim_group(self, o: Clause, n: Clause, group_text: str) -> float:
        """분할/병합 후보(여러 조항을 이어붙인 가상 조항)와의 유사도. o 또는 n 중 하나가 가상 조항."""
        if o.id == "tmp":
            return self._score(o, _TextFeat(group_text), n, self.feat(n))
        return self._score(o, self.feat(o), n, _TextFeat(group_text))


def _number_prefix_match(parent: Optional[str], child: Optional[str]) -> bool:
    if not parent or not child:
        return False
    return child.startswith(parent + ".") or child.startswith(parent + "의") or child.startswith(parent + "-")


SPLIT_MERGE_TOP_K = 6  # 분할·병합 후보 창(window)은 유사도 상위 K개 조항을 포함하는 것만 평가


def detect_repeated_clause_numbers(clauses: List[Clause]) -> Set[str]:
    counts = Counter(c.clause_number for c in clauses if c.clause_number)
    return {num for num, cnt in counts.items() if cnt > 1}


def align_clauses_pipeline(
    project_id: str,
    old_doc: Document,
    new_doc: Document,
    old_clauses: List[Clause],
    new_clauses: List[Clause],
    old_segments: List[Segment],
    new_segments: List[Segment],
    max_group: int = 3,
    fixture_alignments: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[List[Alignment], List[Evidence], Coverage]:
    """구판/신판 조항을 정렬하고 커버리지 불변식(모든 조항 정확히 1회 할당)을 검증한다 ([H2-3])."""
    old_by_id = {c.id: c for c in old_clauses}
    new_by_id = {c.id: c for c in new_clauses}
    old_segs_by_id = {s.id: s for s in old_segments}
    new_segs_by_id = {s.id: s for s in new_segments}

    repeated_old_nums = detect_repeated_clause_numbers(old_clauses)
    repeated_new_nums = detect_repeated_clause_numbers(new_clauses)

    used_old: Set[str] = set()
    used_new: Set[str] = set()
    alignments: List[Alignment] = []
    all_evidences: List[Evidence] = []

    # ------------------------------------------------------------------
    # 0단계: 명시적 Fixture 또는 LLM 구조화 정렬 지시가 있는 경우 우선 적용
    # (조항 번호 + heading_path 매핑으로 정확히 찾음)
    # ------------------------------------------------------------------
    if fixture_alignments:
        def resolve_clause_ref(clauses_list: List[Clause], ref: Dict[str, Any], used_set: Set[str]) -> Optional[Clause]:
            c_num = ref.get("clause_number")
            h_sub = ref.get("heading_contains", "")
            text_sub = ref.get("text_contains", "")
            for cl in clauses_list:
                if cl.id in used_set:
                    continue
                if c_num and cl.clause_number != c_num:
                    continue
                if h_sub and h_sub.lower() not in (cl.heading_path or "").lower():
                    continue
                if text_sub and text_sub.lower() not in cl.text.lower():
                    continue
                return cl
            return None

        for spec in fixture_alignments:
            matched_old: List[Clause] = []
            matched_new: List[Clause] = []
            for o_ref in spec.get("old_refs", []):
                found = resolve_clause_ref(old_clauses, o_ref, used_old)
                if found:
                    matched_old.append(found)
            for n_ref in spec.get("new_refs", []):
                found = resolve_clause_ref(new_clauses, n_ref, used_new)
                if found:
                    matched_new.append(found)

            if not matched_old and not matched_new:
                continue

            for o in matched_old:
                used_old.add(o.id)
            for n in matched_new:
                used_new.add(n.id)

            ev_ids, evs = _build_alignment_evidences(
                matched_old, matched_new, old_doc, new_doc, old_segs_by_id, new_segs_by_id
            )
            all_evidences.extend(evs)

            flags = list(spec.get("flags", []))
            for o in matched_old:
                if o.clause_number in repeated_old_nums and "repeated_number" not in flags:
                    flags.append("repeated_number")
            for n in matched_new:
                if n.clause_number in repeated_new_nums and "repeated_number" not in flags:
                    flags.append("repeated_number")

            alignments.append(
                Alignment(
                    id=f"aln-{project_id}-{len(alignments)+1:03d}",
                    project_id=project_id,
                    old_clause_ids=[o.id for o in matched_old],
                    new_clause_ids=[n.id for n in matched_new],
                    method=spec.get("method", "llm"),
                    relationship=spec.get("relationship", "one_to_one"),
                    flags=flags,
                    confidence_band=spec.get("confidence_band", "high"),
                    similarity_score=float(spec.get("similarity_score", 0.92)),
                    explanation=spec.get("explanation", "의미 기반 조항 정렬 완료"),
                    evidence_ids=ev_ids,
                    review_status="unreviewed",
                    revision=1,
                )
            )

    sim_index = _SimilarityIndex()
    n_old_total = max(1, len(old_clauses))
    n_new_total = max(1, len(new_clauses))

    # ------------------------------------------------------------------
    # 1단계: 결정론적 완전 동일(Exact) 및 번호만 이동된 동일 본문 연결 ([H2-3.4], T2)
    # 신판 조항을 해시/정규화 본문/서식무시 본문으로 색인해 O(N)으로 찾고,
    # 같은 본문이 여러 곳에 반복되면(상용구) 같은 조항번호 → 문서 내 상대 위치가 가까운 순으로 고른다.
    # ------------------------------------------------------------------
    by_hash: Dict[str, List[Clause]] = {}
    by_body: Dict[str, List[Clause]] = {}
    by_alnum_num: Dict[Tuple[str, str], List[Clause]] = {}
    for ncl in new_clauses:
        n_body_norm, _ = normalize_with_map(strip_clause_prefix(ncl.text))
        by_hash.setdefault(ncl.content_hash, []).append(ncl)
        if n_body_norm:
            by_body.setdefault(n_body_norm, []).append(ncl)
        n_alnum = _alnum_hangul_only(n_body_norm)
        if n_alnum:
            by_alnum_num.setdefault((n_alnum, ncl.clause_number or ""), []).append(ncl)

    for ocl in old_clauses:
        if ocl.id in used_old:
            continue
        o_body_norm, _ = normalize_with_map(strip_clause_prefix(ocl.text))
        o_alnum = _alnum_hangul_only(o_body_norm)

        candidates: List[Tuple[Tuple[int, int, float], Clause, str]] = []
        for ncl in by_hash.get(ocl.content_hash, []):
            if ncl.id not in used_new:
                candidates.append(((0, 0, 0.0), ncl, "hash"))
        if o_body_norm:
            for ncl in by_body.get(o_body_norm, []):
                if ncl.id not in used_new:
                    candidates.append(((0, 1, 0.0), ncl, "body"))
        if o_alnum:
            for ncl in by_alnum_num.get((o_alnum, ocl.clause_number or ""), []):
                if ncl.id not in used_new:
                    candidates.append(((0, 2, 0.0), ncl, "alnum"))
        if not candidates:
            continue

        def _rank(item: Tuple[Tuple[int, int, float], Clause, str]) -> Tuple[int, int, float]:
            _, ncl, kind = item
            same_num = 0 if (ocl.clause_number or "") == (ncl.clause_number or "") else 1
            kind_rank = {"hash": 0, "body": 1, "alnum": 2}[kind]
            rel_dist = abs(ocl.sequence_no / n_old_total - ncl.sequence_no / n_new_total)
            return (same_num, kind_rank, rel_dist)

        _, ncl, kind = min(candidates, key=_rank)
        if kind == "hash":
            flags: List[str] = []
            if ocl.clause_number in repeated_old_nums or ncl.clause_number in repeated_new_nums:
                flags.append("repeated_number")
            expl = " 원문 해시 100% 일치 (완전 동일)"
        elif kind == "body":
            flags = ["moved"] if ocl.clause_number != ncl.clause_number else []
            if ocl.clause_number in repeated_old_nums or ncl.clause_number in repeated_new_nums:
                flags.append("repeated_number")
            expl = (
                f"조항 번호만 {ocl.clause_number} → {ncl.clause_number}(으)로 이동되었으며 본문 내용은 동일함"
                if "moved" in flags
                else "본문 내용 완전 동일"
            )
        else:
            flags = ["format_only"]
            expl = "문장부호·공백 등 서식만 변경되고 실질 문구와 수치는 동일함"

        used_old.add(ocl.id)
        used_new.add(ncl.id)
        ev_ids, evs = _build_alignment_evidences(
            [ocl], [ncl], old_doc, new_doc, old_segs_by_id, new_segs_by_id
        )
        all_evidences.extend(evs)
        alignments.append(
            Alignment(
                id=f"aln-{project_id}-{len(alignments)+1:03d}",
                project_id=project_id,
                old_clause_ids=[ocl.id],
                new_clause_ids=[ncl.id],
                method="exact",
                relationship="one_to_one",
                flags=flags,
                confidence_band="high",
                similarity_score=1.0,
                explanation=expl,
                evidence_ids=ev_ids,
                review_status="unreviewed",
                revision=1,
            )
        )

    # ------------------------------------------------------------------
    # 2단계: 분할(1 -> 2..3) 및 병합(2..3 -> 1) 후보 탐지 ([H2-3.5], T3)
    # 연속된 최대 max_group(기본 3)개 조항의 합집합 유사도가 개별 유사도보다 현저히 높을 때 선택.
    # 성능: 유사도 상위 K개 조항(또는 번호 체계상 하위 조항)을 포함하는 연속 창만 평가한다.
    # ------------------------------------------------------------------
    def _candidate_windows(
        anchor: Clause, pool: List[Clause], score_fn, prefix_ok
    ) -> List[Tuple[int, int]]:
        if len(pool) < 2:
            return []
        scored = sorted(range(len(pool)), key=lambda j: score_fn(pool[j]), reverse=True)
        seeds = set(scored[:SPLIT_MERGE_TOP_K])
        for j, c in enumerate(pool):
            if prefix_ok(c):
                seeds.add(j)
        windows: Set[Tuple[int, int]] = set()
        for j in seeds:
            for k in range(2, max_group + 1):
                for start_i in range(j - k + 1, j + 1):
                    if start_i >= 0 and start_i + k <= len(pool):
                        windows.add((start_i, k))
        return sorted(windows)

    # 2a. 1 -> K 분할 탐지
    for ocl in [c for c in old_clauses if c.id not in used_old]:
        if ocl.id in used_old:
            continue
        avail_new = [c for c in new_clauses if c.id not in used_new]
        best_single = max((sim_index.sim(ocl, n) for n in avail_new), default=0.0)
        best_group: Optional[Tuple[List[Clause], float]] = None
        best_rank: Tuple[bool, int, float] = (False, 0, 0.0)

        for i, k in _candidate_windows(
            ocl,
            avail_new,
            lambda n: sim_index.sim(ocl, n),
            lambda n: _number_prefix_match(ocl.clause_number, n.clause_number),
        ):
            group = avail_new[i : i + k]
            if any(group[j + 1].sequence_no - group[j].sequence_no != 1 for j in range(len(group) - 1)):
                continue
            sub_sims = [sim_index.sim(ocl, g) for g in group]
            if min(sub_sims) < 0.16:
                continue
            combined_new_clause = Clause(
                id="tmp",
                document_id=new_doc.id,
                version_side="new",
                heading_path=group[0].heading_path,
                clause_number=group[0].clause_number,
                text="\n".join(strip_clause_prefix(g.text) for g in group),
                sequence_no=group[0].sequence_no,
                content_hash="",
            )
            grp_sim = sim_index.sim_group(ocl, combined_new_clause, combined_new_clause.text)
            is_children = bool(ocl.clause_number) and all(
                _number_prefix_match(ocl.clause_number, g.clause_number) for g in group
            )
            if is_children:
                grp_sim = min(0.99, grp_sim + 0.22)
            if grp_sim >= max(0.38, best_single + 0.06):
                # 번호 체계상 하위 조항(제2조 → 제2조의1~3, 3.2 → 3.2.1~3.2.3)이면 하위 조항을 모두 포함하는 큰 묶음을 우선
                rank = (is_children, len(group) if is_children else 0, grp_sim)
                if best_group is None or rank > best_rank:
                    best_group = (group, grp_sim)
                    best_rank = rank

        if best_group is not None:
            grp, sim_val = best_group
            used_old.add(ocl.id)
            for g in grp:
                used_new.add(g.id)
            ev_ids, evs = _build_alignment_evidences(
                [ocl], grp, old_doc, new_doc, old_segs_by_id, new_segs_by_id
            )
            all_evidences.extend(evs)
            new_nums = ", ".join(g.clause_number or g.id for g in grp)
            alignments.append(
                Alignment(
                    id=f"aln-{project_id}-{len(alignments)+1:03d}",
                    project_id=project_id,
                    old_clause_ids=[ocl.id],
                    new_clause_ids=[g.id for g in grp],
                    method="similarity",
                    relationship="one_to_many",
                    flags=["split"],
                    confidence_band="high" if sim_val >= 0.55 else "medium",
                    similarity_score=sim_val,
                    explanation=f"구판 {ocl.clause_number} 조항이 신판 {new_nums} ({len(grp)}개 조항)으로 분할됨",
                    evidence_ids=ev_ids,
                    review_status="unreviewed",
                    revision=1,
                )
            )

    # 2b. K -> 1 병합 탐지
    for ncl in [c for c in new_clauses if c.id not in used_new]:
        if ncl.id in used_new:
            continue
        avail_old = [c for c in old_clauses if c.id not in used_old]
        best_single = max((sim_index.sim(o, ncl) for o in avail_old), default=0.0)
        best_group_old: Optional[Tuple[List[Clause], float]] = None

        for i, k in _candidate_windows(
            ncl,
            avail_old,
            lambda o: sim_index.sim(o, ncl),
            lambda o: False,
        ):
            group = avail_old[i : i + k]
            if any(group[j + 1].sequence_no - group[j].sequence_no != 1 for j in range(len(group) - 1)):
                continue
            sub_sims = [sim_index.sim(g, ncl) for g in group]
            if min(sub_sims) < 0.16:
                continue
            combined_old_clause = Clause(
                id="tmp",
                document_id=old_doc.id,
                version_side="old",
                heading_path=group[0].heading_path,
                clause_number=group[0].clause_number,
                text="\n".join(strip_clause_prefix(g.text) for g in group),
                sequence_no=group[0].sequence_no,
                content_hash="",
            )
            grp_sim = sim_index.sim_group(combined_old_clause, ncl, combined_old_clause.text)
            if grp_sim >= max(0.38, best_single + 0.06):
                if best_group_old is None or grp_sim > best_group_old[1]:
                    best_group_old = (group, grp_sim)

        if best_group_old is not None:
            grp, sim_val = best_group_old
            for g in grp:
                used_old.add(g.id)
            used_new.add(ncl.id)
            ev_ids, evs = _build_alignment_evidences(
                grp, [ncl], old_doc, new_doc, old_segs_by_id, new_segs_by_id
            )
            all_evidences.extend(evs)
            old_nums = ", ".join(g.clause_number or g.id for g in grp)
            alignments.append(
                Alignment(
                    id=f"aln-{project_id}-{len(alignments)+1:03d}",
                    project_id=project_id,
                    old_clause_ids=[g.id for g in grp],
                    new_clause_ids=[ncl.id],
                    method="similarity",
                    relationship="many_to_one",
                    flags=["merged"],
                    confidence_band="high" if sim_val >= 0.55 else "medium",
                    similarity_score=sim_val,
                    explanation=f"구판 {old_nums} ({len(grp)}개 조항)이 신판 {ncl.clause_number} 조항으로 병합됨",
                    evidence_ids=ev_ids,
                    review_status="unreviewed",
                    revision=1,
                )
            )

    # ------------------------------------------------------------------
    # 3단계: 양방향 유사도 1:1 후보 정렬 (번호 이동 + 내용 변경 포함)
    # ------------------------------------------------------------------
    scored_pairs: List[Tuple[float, Clause, Clause]] = []
    for ocl in old_clauses:
        if ocl.id in used_old:
            continue
        for ncl in new_clauses:
            if ncl.id in used_new:
                continue
            sim = sim_index.sim(ocl, ncl)
            # 조항 번호가 같고 같은 장(또는 장 정보 없음)이면서 최소 주제 유사도가 있으면 가산점
            same_num = (ocl.clause_number and ocl.clause_number == ncl.clause_number)
            same_chapter = (
                not ocl.heading_path
                or not ncl.heading_path
                or _token_sim(sim_index.head_toks(ocl), sim_index.head_toks(ncl)) > 0.3
            )
            if same_num and same_chapter and sim >= 0.18:
                sim = min(0.99, sim + 0.15)
            if sim >= 0.25:
                scored_pairs.append((sim, ocl, ncl))

    scored_pairs.sort(key=lambda x: x[0], reverse=True)
    for sim, ocl, ncl in scored_pairs:
        if ocl.id in used_old or ncl.id in used_new:
            continue
        used_old.add(ocl.id)
        used_new.add(ncl.id)
        flags = []
        if ocl.clause_number != ncl.clause_number:
            flags.append("moved")
        if ocl.clause_number in repeated_old_nums or ncl.clause_number in repeated_new_nums:
            flags.append("repeated_number")

        ev_ids, evs = _build_alignment_evidences(
            [ocl], [ncl], old_doc, new_doc, old_segs_by_id, new_segs_by_id
        )
        all_evidences.extend(evs)
        method_val = "anchor" if ocl.clause_number == ncl.clause_number else "similarity"
        band = "high" if sim >= 0.60 else ("medium" if sim >= 0.38 else "low")
        expl = (
            f"구판 {ocl.clause_number} → 신판 {ncl.clause_number} 번호 이동 및 내용 변경 (유사도 {sim:.2f})"
            if "moved" in flags
            else f"동일 조항({ocl.clause_number}) 내용 개정 대응 (유사도 {sim:.2f})"
        )
        alignments.append(
            Alignment(
                id=f"aln-{project_id}-{len(alignments)+1:03d}",
                project_id=project_id,
                old_clause_ids=[ocl.id],
                new_clause_ids=[ncl.id],
                method=method_val,
                relationship="one_to_one",
                flags=flags,
                confidence_band=band,
                similarity_score=sim,
                explanation=expl,
                evidence_ids=ev_ids,
                review_status="unreviewed",
                revision=1,
            )
        )

    # ------------------------------------------------------------------
    # 4단계: 미매칭 조항을 미해결(unmatched_old / unmatched_new)로 보존 ([H2-3.6, H2-3.7], T4)
    # 검색 실패만으로 삭제/신설 확정하지 않고 후보/미해결 상태로 남김
    # ------------------------------------------------------------------
    for ocl in old_clauses:
        if ocl.id not in used_old:
            used_old.add(ocl.id)
            ev_ids, evs = _build_alignment_evidences(
                [ocl], [], old_doc, new_doc, old_segs_by_id, new_segs_by_id
            )
            all_evidences.extend(evs)
            alignments.append(
                Alignment(
                    id=f"aln-{project_id}-{len(alignments)+1:03d}",
                    project_id=project_id,
                    old_clause_ids=[ocl.id],
                    new_clause_ids=[],
                    method="similarity",
                    relationship="unmatched_old",
                    flags=["unmatched"],
                    confidence_band="low",
                    similarity_score=0.0,
                    explanation=f"구판 {ocl.clause_number} 조항에 대응하는 신판 조항 미발견 (삭제 후보 / 담당자 확인 필요)",
                    evidence_ids=ev_ids,
                    review_status="unreviewed",
                    revision=1,
                )
            )

    for ncl in new_clauses:
        if ncl.id not in used_new:
            used_new.add(ncl.id)
            ev_ids, evs = _build_alignment_evidences(
                [], [ncl], old_doc, new_doc, old_segs_by_id, new_segs_by_id
            )
            all_evidences.extend(evs)
            alignments.append(
                Alignment(
                    id=f"aln-{project_id}-{len(alignments)+1:03d}",
                    project_id=project_id,
                    old_clause_ids=[],
                    new_clause_ids=[ncl.id],
                    method="similarity",
                    relationship="unmatched_new",
                    flags=["unmatched"],
                    confidence_band="low",
                    similarity_score=0.0,
                    explanation=f"신판 {ncl.clause_number} 조항에 대응하는 구판 조항 미발견 (신설 후보 / 담당자 확인 필요)",
                    evidence_ids=ev_ids,
                    review_status="unreviewed",
                    revision=1,
                )
            )

    # 구판/신판 등장 순서에 맞춰 정렬
    def sort_key(al: Alignment) -> Tuple[int, int]:
        o_seq = min((old_by_id[cid].sequence_no for cid in al.old_clause_ids if cid in old_by_id), default=9999)
        n_seq = min((new_by_id[cid].sequence_no for cid in al.new_clause_ids if cid in new_by_id), default=9999)
        return (min(o_seq, n_seq), o_seq)

    alignments.sort(key=sort_key)

    coverage = validate_alignment_coverage(
        project_id=project_id,
        old_clauses=old_clauses,
        new_clauses=new_clauses,
        alignments=alignments,
        failed_alignments=0,
    )
    return alignments, all_evidences, coverage


def validate_alignment_coverage(
    project_id: str,
    old_clauses: List[Clause],
    new_clauses: List[Clause],
    alignments: List[Alignment],
    failed_alignments: int = 0,
) -> Coverage:
    """모든 구판/신판 조항이 정확히 하나의 그룹에 속하는지 커버리지 불변식을 검증한다 ([H2-3.6])."""
    old_counter: CounterType[str] = Counter()
    new_counter: CounterType[str] = Counter()
    unresolved_old = 0
    unresolved_new = 0

    for al in alignments:
        for oid in al.old_clause_ids:
            old_counter[oid] += 1
        for nid in al.new_clause_ids:
            new_counter[nid] += 1
        if al.relationship == "unmatched_old" and al.review_status == "unreviewed":
            unresolved_old += len(al.old_clause_ids)
        if al.relationship == "unmatched_new" and al.review_status == "unreviewed":
            unresolved_new += len(al.new_clause_ids)

    all_old_ids = {c.id for c in old_clauses}
    all_new_ids = {c.id for c in new_clauses}

    accounted_old = len(set(old_counter.keys()) & all_old_ids)
    accounted_new = len(set(new_counter.keys()) & all_new_ids)
    dup_old = sum(1 for cid, cnt in old_counter.items() if cnt > 1)
    dup_new = sum(1 for cid, cnt in new_counter.items() if cnt > 1)

    scope_str = (
        ",".join(sorted(all_old_ids)) + "|" + ",".join(sorted(all_new_ids))
    )
    scope_hash = hashlib.sha256(scope_str.encode("utf-8")).hexdigest()[:16]

    is_complete = (
        accounted_old == len(all_old_ids)
        and accounted_new == len(all_new_ids)
        and dup_old == 0
        and dup_new == 0
        and failed_alignments == 0
    )

    return Coverage(
        project_id=project_id,
        total_old_clauses=len(all_old_ids),
        total_new_clauses=len(all_new_ids),
        accounted_old=accounted_old,
        accounted_new=accounted_new,
        unresolved_old=unresolved_old,
        unresolved_new=unresolved_new,
        duplicate_old=dup_old,
        duplicate_new=dup_new,
        analyzed_alignments=len(alignments),
        failed_alignments=failed_alignments,
        is_complete=is_complete,
        scope_hash=scope_hash,
    )
