/**
 * 브라우저 변경체크 엔진이 쓰는 Python 패키지 목록 (한 곳에서 관리).
 *  - copy-pyodide.ts 가 이 목록대로 사이트에 넣고,
 *  - check-vulns.ts 가 이 목록으로 취약점(OSV)을 검사하고,
 *  - 단위 테스트가 engine/requirements.txt(보안 검사기가 읽는 파일)와 버전이 같은지 확인한다.
 */

/** 엔진이 import 하는 Pyodide 내장 패키지 (의존성 포함). 버전은 node_modules/pyodide/pyodide-lock.json 을 따른다. Pillow 는 엔진이 쓰지 않아 넣지 않는다. */
export const BUILTIN_PACKAGES = ['micropip', 'packaging', 'lxml', 'pydantic', 'pydantic-core', 'typing-extensions', 'annotated-types', 'typing-inspection'];

export interface PureWheel {
  name: string;
  version: string;
  file: string;
  sha256: string;
  url: string;
}

/** micropip 로 설치할 순수 Python 휠 — engine/requirements.txt 와 버전이 같아야 한다(테스트로 확인). */
export const PURE_WHEELS: PureWheel[] = [
  {
    // 6.17.0 → 6.21.4: GHSA·PYSEC 32건(조작된 PDF 로 인한 무한 루프·메모리 고갈 등) 해결 (2026-11-05 OSV 기준 최신)
    name: 'pypdf',
    version: '6.21.4',
    file: 'pypdf-6.21.4-py3-none-any.whl',
    sha256: '33e4fb41ca352810eb4e9838aa0d82d6888a5f8bf682f43e99cce5faa666255c',
    url: 'https://files.pythonhosted.org/packages/3f/4b/77e8ad4ac42c9d93600f40541a50e9feb3a61d2bbee2d76f659346072051/pypdf-6.21.4-py3-none-any.whl',
  },
  {
    name: 'python-docx',
    version: '1.2.0',
    file: 'python_docx-1.2.0-py3-none-any.whl',
    sha256: '3fd478f3250fbbbfd3b94fe1e985955737c145627498896a8a6bf81f4baf66c7',
    url: 'https://files.pythonhosted.org/packages/d0/00/1e03a4989fa5795da308cd774f05b704ace555a70f9bf9d3be057b680bcf/python_docx-1.2.0-py3-none-any.whl',
  },
  {
    name: 'openpyxl',
    version: '3.1.5',
    file: 'openpyxl-3.1.5-py2.py3-none-any.whl',
    sha256: '5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2',
    url: 'https://files.pythonhosted.org/packages/c0/da/977ded879c29cbd04de313843e76868e6e13408a94ed6b987245dc7c8506/openpyxl-3.1.5-py2.py3-none-any.whl',
  },
  {
    name: 'et-xmlfile',
    version: '2.0.0',
    file: 'et_xmlfile-2.0.0-py3-none-any.whl',
    sha256: '7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa',
    url: 'https://files.pythonhosted.org/packages/c1/8b/5fe2cc11fee489817272089c4203e679c63b570a5aaeb18d852ae3cbba6a/et_xmlfile-2.0.0-py3-none-any.whl',
  },
  {
    name: 'defusedxml',
    version: '0.7.1',
    file: 'defusedxml-0.7.1-py2.py3-none-any.whl',
    sha256: 'a352e7e428770286cc899e2542b6cdaedb2b4953ff269a210103ec58f6198a61',
    url: 'https://files.pythonhosted.org/packages/07/6c/aa3f2f849e01cb6a001cd8554a88d4c77c5c1a31c95bdf1cf9301e6d9ef4/defusedxml-0.7.1-py2.py3-none-any.whl',
  },
];

/** PEP 503 이름 정규화 (pyodide-lock 의 depends 는 pydantic_core, 키는 pydantic-core 처럼 섞여 있음) */
export const canon = (n: string) => n.toLowerCase().replace(/[-_.]+/g, '-');
