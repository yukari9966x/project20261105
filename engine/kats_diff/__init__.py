"""kats_diff — 국가기술표준원 해외규제 변경체크 엔진 (브라우저/Pyodide 이식판).

원본: kats-regulation-diff v0.2 (FastAPI·SQLite 로컬 앱). 이 패키지는 도메인 로직(조항 분할·정렬·
변경/수치/기한 추출·원문 근거 검증·체크리스트·내보내기)을 그대로 쓰고, 서버·DB·작업큐·서버측 LLM 호출을 걷어냈다.
진입점은 `kats_diff.pipeline`.
"""
from .pipeline import ENGINE_VERSION  # noqa: F401
