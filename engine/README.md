# engine/ — 해외규제 변경체크 엔진 (kats-regulation-diff 브라우저 이식판)

원본: `kats-regulation-diff` v0.2 (FastAPI·SQLite 로컬 앱, 2026 산업부 AI 활용 경진대회 출품용).
이 폴더는 원본의 **도메인 로직을 그대로** 가져와 브라우저(Pyodide 314.0.7, Python 3.14)에서 돌도록 정리한 것입니다.

| 원본 | 이식판 | 바뀐 점 |
|---|---|---|
| `app/schemas/domain.py` | `kats_diff/schemas.py` | 그대로 (pydantic 2.12.5 — Pyodide 내장) |
| `app/domain/{patterns,segmenter,aligner,change_extractor,numeric_date}.py` | `kats_diff/*.py` | import 경로만 |
| `app/services/ingest/parser.py` | `kats_diff/parser.py` | 서버 설정(app.config) → 같은 상한값 상수, OCR 제거(스캔본은 NEEDS_OCR 안내), 디스크 저장 제거 |
| `app/services/evidence/verifier.py` | `kats_diff/verifier.py` | import 경로만 |
| `app/services/export/exporter.py` | `kats_diff/exporter.py` | SQLite 대신 메모리 상태에서 묶음 생성, 실행 모드 문구 |
| `app/services/jobs/runner.py` (+DB·작업큐) | `kats_diff/pipeline.py` | 같은 순서의 메모리 파이프라인. LLM 호출은 브라우저(TS)가 하고 엔진은 입력 준비·출력 검증·병합만 |
| — | `kats_diff/bridge.py` | Web Worker 연결부 (JSON 주고받기, 오류 → code·message·remediation) |
| `prompts/change_extract_v1.txt` | `prompts/` | 그대로 (브라우저 LLM 보강이 사용) |
| `sample_data/` | `samples/`, `kats_diff/samples/fixture_registry.json` | 가상 규정 4쌍·정답 레이블·기록된 AI 응답(샘플 해시가 정확히 같을 때만 재생) |

빠진 것: FastAPI 라우터·SQLite·작업 큐·서버 측 LLM 어댑터(정책 게이트는 브라우저 동의 절차로 대체)·OCR·수동 조항 연결 편집(원본 로컬 앱에서 제공).

## 검증

```bash
python3 -m venv .venv && .venv/bin/pip install -r engine/requirements.txt
```

```bash
.venv/bin/python -m unittest discover -s engine/tests -t engine
```

```bash
.venv/bin/python engine/scripts/evaluate.py --mode all
```

- 테스트 25건: 원본 단위(T2~T7·T9)·외국 규정 규칙·실제형 문서 회귀(DOCX·PDF·HWPX·TXT)·성능 + 파이프라인(내보내기 재열기, LLM 출력 검증·검토 초기화) + 연결부.
- 같은 25건을 실제 Pyodide 에서도 실행: `npm run prepare-data && node scripts/smoke-pyodide.mjs --unittest`
- 평가셋(가상 규정 4쌍, 정답 26사례) 규칙 엔진 단독: 조항 정렬 26/26 · 변경 탐지 P/R/F1 1.0 · 수치·기한 13/13 · 근거 유효 68/68 — 원본 v0.2 TEST_REPORT 와 같은 값.
