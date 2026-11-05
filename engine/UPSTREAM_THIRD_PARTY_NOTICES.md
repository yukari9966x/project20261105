# 오픈소스 및 제3자 소프트웨어 고지 (`THIRD_PARTY_NOTICES.md`)

> **이 파일은 원본 `kats-regulation-diff`(로컬 FastAPI 앱)의 고지문입니다.** 이 저장소의 브라우저 이식판이 실제로 쓰는 패키지와 버전은 [`requirements.txt`](requirements.txt)와 `scripts/lib/pyodide-packages.ts` 를 따르며, FastAPI·Uvicorn 등 서버 패키지는 쓰지 않습니다.

버전은 `requirements.txt`(실행), `requirements-dev.txt`(개발), `requirements-ocr.txt`(선택 OCR) 기준입니다.
**재배포가 제한되는 GPL·AGPL 계열 라이선스는 사용하지 않습니다.**

## 1. 실행 필수 패키지 (`requirements.txt`)

| 패키지 | 버전 | 라이선스 | 용도 |
|---|---|---|---|
| FastAPI | 0.128.8 | MIT | 웹 API 프레임워크 |
| Starlette | 0.50.0 | BSD-3-Clause | 웹 라우팅·미들웨어 |
| Pydantic | 2.13.5 | MIT | 데이터 모델·JSON 스키마 검증 |
| Uvicorn | 0.54.0 | BSD-3-Clause | 로컬 웹 서버 |
| python-multipart | 0.0.32 | Apache-2.0 | 파일 업로드 처리 |
| Jinja2 | 3.1.6 | BSD-3-Clause | 화면 템플릿 |
| python-dotenv | 1.2.3 | BSD-3-Clause | `.env` 설정 읽기 |
| HTTPX | 0.28.1 | BSD-3-Clause | LLM API 호출 |
| pypdf | 6.17.0 → **6.21.4** (브라우저 이식판, 2026-11-05 보안 업데이트: GHSA·PYSEC 32건) | BSD-3-Clause | PDF 텍스트 추출 |
| python-docx | 1.2.0 | MIT | DOCX 읽기·보고서 생성 |
| openpyxl | 3.1.5 | MIT | XLSX 보고서 생성 |
| defusedxml | 0.7.1 | PSF-2.0 | DOCX·HWPX XML 안전 파싱(XXE 차단) |

주요 하위 의존성: annotated-doc(MIT), anyio(MIT), h11(MIT), httpcore(BSD-3), lxml(BSD-3), MarkupSafe(BSD-3), et_xmlfile(MIT), Pillow(MIT-CMU), typing-extensions(PSF), idna(BSD-3), **certifi(MPL-2.0 — 파일 단위 약한 카피레프트: 수정 없이 사용 시 별도 의무 없음)**

## 2. 선택 패키지

| 패키지 | 버전 | 라이선스 | 용도 |
|---|---|---|---|
| Selenium (`requirements-dev.txt`) | 4.8 이상 | Apache-2.0 | 브라우저 E2E 테스트 |
| Requests (`requirements-dev.txt`) | 2.31 이상 | Apache-2.0 | E2E 테스트 보조 |
| ReportLab (`requirements-dev.txt`) | 5.0.1 | BSD-3-Clause | 가상 규정 샘플 PDF·회귀 문서 재생성 |
| pytesseract (`requirements-ocr.txt`) | 0.3.13 | Apache-2.0 | 스캔본 PDF OCR 연동 |
| pypdfium2 (`requirements-ocr.txt`) | 5.13.0 | Apache-2.0 또는 BSD-3 (PDFium: BSD-3) | PDF 쪽 이미지 변환 |
| Tesseract OCR (별도 설치 프로그램) | 5.x | Apache-2.0 | OCR 엔진 (배포본에 포함하지 않음) |

## 3. 외부 AI 서비스
- 기본 데모 모드는 외부 모델·API 를 사용하지 않으며 자체 작성한 응답 기록(fixture)만 재생합니다.
- 사용자가 `.env` 로 Google Gemini, OpenAI, Anthropic Claude 등 API 를 연결하면 해당 공급자의 이용 약관이 적용됩니다.
- 배포 zip 에는 API 키나 모델 가중치가 포함되지 않습니다.
