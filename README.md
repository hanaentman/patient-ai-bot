# 병원 환자용 AI 상담봇 MVP

스마트폰 브라우저에서 바로 접속할 수 있는 병원 안내용 웹 챗봇입니다.
현재 버전은 `병원 홈페이지 문서 검색 + OpenAI 응답` 방식으로 동작합니다.

## 포함 기능

- 병원 홈페이지 다중 페이지 크롤링 검색
- OpenAI 기반 자연어 답변
- 진료시간, 위치, 의료진, 서류 발급, 입퇴원 안내
- 응급성 키워드 차단 및 119/응급실 안내
- 진단/처방 변경 질문 차단
- 참고한 문서 출처 표시
- 공식 홈페이지 우선, 공공정보는 보조, 저신뢰 출처는 10% 비중으로 제한 반영

## 실행 방법

```powershell
cd C:\Users\OCSEMR\patient-ai-bot
$env:OPENAI_API_KEY="여기에_발급받은_API키"
node server.js
```

브라우저에서 `http://localhost:3000` 접속

같은 와이파이에 연결된 스마트폰에서 테스트하려면 PC IP로 접속하면 됩니다.
예: `http://192.168.0.10:3000`

선택:

```powershell
$env:OPENAI_MODEL="gpt-5-mini"
```

## 병원 실사용 전 수정할 항목

- `data/site-sources.json`에 검색 시작 URL과 신뢰 출처 추가
- `data/site-sources.json`에서 `type`으로 가중치 관리
  - `official`: 100%
  - `external`: 30%
  - `low_trust`: 10%
- `data/faq.json`의 병원 운영 정책 수시 보정
- 예약 시스템 URL 또는 API 연동
- 관리자 로그인, 상담 이력 저장, 개인정보 마스킹 추가
- 내부망/DMZ 기반 배포 구조 설계

## 인터넷 배포

가장 쉬운 방법은 Render 배포입니다.

1. GitHub에 이 프로젝트 업로드
2. Render에서 `New +` > `Blueprint` 또는 `Web Service` 선택
3. 저장소 연결
4. 환경변수 `OPENAI_API_KEY` 입력
5. 배포 완료 후 발급된 `onrender.com` 주소로 접속
6. 필요하면 병원 도메인 연결

배포 설정 파일:

- `render.yaml`: Render용 배포 설정

### Render에서 로그 유지하기

Render 웹서비스의 기본 파일시스템은 임시 저장소라서 서버가 재시작되면 런타임에 생성한 로그 파일이 사라집니다.
이 프로젝트는 `PERSISTENT_DATA_DIR` 경로에 로그와 인기 질문 통계를 저장하도록 구성되어 있습니다.

- `render.yaml`은 `starter` 플랜과 persistent disk를 사용하도록 설정되어 있습니다.
- 관리자 로그는 `${PERSISTENT_DATA_DIR}/chat-logs.db`에 저장됩니다.
- `PERSISTENT_DATA_DIR`가 없거나 persistent disk가 연결되지 않으면 재시작 후 로그가 유지되지 않습니다.

## 파일 구조

- `server.js`: 홈페이지 검색, OpenAI 호출, 챗 응답 API
- `public/index.html`: 모바일 챗 화면
- `public/style.css`: 스마트폰 중심 UI 스타일
- `public/app.js`: 프론트엔드 채팅 동작
- `data/faq.json`: 병원 FAQ 데이터
- `data/site-sources.json`: 검색할 병원 홈페이지 URL 목록
