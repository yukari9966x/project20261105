"""브라우저 Web Worker ↔ 변경체크 엔진 연결부.

Web Worker(src/engine/worker.ts)가 이 함수들을 부른다. 결과는 JSON 문자열(내보내기 파일은 bytes)로 돌려주고,
엔진 오류(AppException)는 화면이 그대로 보여 줄 수 있게 code·message·remediation 으로 바꾼다.
분석 상태(_STATE)는 이 브라우저 탭의 메모리에만 있고 어디에도 저장·전송하지 않는다.
"""
from __future__ import annotations

import json
import traceback
from typing import Any, Callable, Optional, Tuple

from .pipeline import ENGINE_VERSION, analyze, apply_llm_outputs, export, llm_targets, set_review, to_view
from .schemas import AppException

_STATE = None


def _dump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def _error(exc: BaseException) -> dict:
    if isinstance(exc, AppException):
        return {"ok": False, "error": {"code": exc.code, "message": exc.message_ko, "remediation": exc.remediation}}
    return {
        "ok": False,
        "error": {
            "code": "INTERNAL_ERROR",
            "message": f"분석 중 예기치 않은 오류가 발생했습니다: {type(exc).__name__}: {exc}",
            "remediation": "다른 형식(DOCX·텍스트형 PDF·TXT)으로 저장해 다시 시도하세요.",
            "trace": traceback.format_exc()[-3000:],
        },
    }


def version() -> str:
    return ENGINE_VERSION


def run_analyze(old_name: str, old_data: Any, new_name: str, new_data: Any, meta_json: str = "{}", progress: Optional[Callable] = None) -> str:
    global _STATE
    try:
        meta = json.loads(meta_json or "{}")
        _STATE = analyze(
            old_name,
            bytes(old_data),
            new_name,
            bytes(new_data),
            title=str(meta.get("title") or ""),
            country=str(meta.get("country") or ""),
            product_scope=str(meta.get("product") or ""),
            old_version=str(meta.get("oldVersion") or ""),
            new_version=str(meta.get("newVersion") or ""),
            target_date=str(meta.get("targetDate") or ""),
            is_synthetic=bool(meta.get("isSynthetic")),
            use_recorded_ai=bool(meta.get("useRecordedAi")),
            progress=progress,
        )
        return _dump({"ok": True, "view": to_view(_STATE)})
    except BaseException as exc:  # noqa: BLE001 — 화면에 오류를 보여 주기 위해 모두 잡는다
        return _dump(_error(exc))


def _need_state() -> None:
    if _STATE is None:
        raise AppException(code="NOT_FOUND", message_ko="먼저 구판·신판 문서를 분석하세요.")


def run_targets() -> str:
    try:
        _need_state()
        return _dump({"ok": True, "targets": llm_targets(_STATE)})
    except BaseException as exc:  # noqa: BLE001
        return _dump(_error(exc))


def run_apply_llm(outputs_json: str, meta_json: str = "{}") -> str:
    try:
        _need_state()
        meta = json.loads(meta_json or "{}")
        res = apply_llm_outputs(
            _STATE,
            json.loads(outputs_json or "{}"),
            provider=str(meta.get("provider") or "openai_compat"),
            model=str(meta.get("model") or ""),
            calls=int(meta.get("calls") or 0),
            total_tokens=meta.get("totalTokens"),
            errors=list(meta.get("errors") or []),
        )
        return _dump({"ok": True, "result": res, "view": to_view(_STATE)})
    except BaseException as exc:  # noqa: BLE001
        return _dump(_error(exc))


def run_review(kind: str, result_id: str, decision: str, note: str = "") -> str:
    try:
        _need_state()
        review = set_review(_STATE, kind, result_id, decision, note)
        return _dump({"ok": True, "review": review, "view": to_view(_STATE)})
    except BaseException as exc:  # noqa: BLE001
        return _dump(_error(exc))


def run_export(fmt: str) -> Tuple[bool, Any, str, str]:
    """(성공여부, 파일 bytes 또는 오류 JSON, MIME, 파일명)"""
    try:
        _need_state()
        data, mime, name = export(_STATE, fmt)
        return True, data, mime, name
    except BaseException as exc:  # noqa: BLE001
        return False, _dump(_error(exc)), "", ""
