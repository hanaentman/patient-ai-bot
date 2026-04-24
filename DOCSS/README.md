# DOCSS

`docs/` 폴더의 TXT 문서를 검색/학습에 더 쓰기 쉬운 Markdown 구조로 정리한 결과물입니다.

## 원칙

- 원본은 `docs/`에 그대로 둡니다.
- 변환본은 `DOCSS/`에 문서 유형별 구조를 붙여 저장합니다.
- 각 문서는 메타데이터 + 구조화 섹션 + 정규화 원문을 함께 가집니다.

## 생성 문서 수

- 총 33개

## 문서 목록

- DOCSS/기타-병원셔틀시간표.md (general) <- docs/기타-병원셔틀시간표.txt
- DOCSS/기타-비급여비용.md (pricing) <- docs/기타-비급여비용.txt
- DOCSS/기타-층별안내도.md (general) <- docs/기타-층별안내도.txt
- DOCSS/병동-FAQ.md (faq) <- docs/병동-FAQ.txt
- DOCSS/외래-의료진 명단.md (doctor_list) <- docs/외래-의료진 명단.txt
- DOCSS/외래-코세척 방법.md (general) <- docs/외래-코세척 방법.txt
- DOCSS/원무-FAQ.md (faq) <- docs/원무-FAQ.txt
- DOCSS/유튜브-링크.md (link_map) <- docs/유튜브-링크.txt
- DOCSS/입원-수면검사 입원 안내.md (general) <- docs/입원-수면검사 입원 안내.txt
- DOCSS/입원-수술 후 주의사항.md (slide_notes) <- docs/입원-수술 후 주의사항.txt
- DOCSS/입원-입원생활안내문.md (general) <- docs/입원-입원생활안내문.txt
- DOCSS/홈페이지-갑상선.md (homepage_topic) <- docs/홈페이지-갑상선.txt
- DOCSS/홈페이지-난청.md (homepage_topic) <- docs/홈페이지-난청.txt
- DOCSS/홈페이지-만성비염.md (homepage_topic) <- docs/홈페이지-만성비염.txt
- DOCSS/홈페이지-만성중이염.md (homepage_topic) <- docs/홈페이지-만성중이염.txt
- DOCSS/홈페이지-목의 혹.md (homepage_topic) <- docs/홈페이지-목의 혹.txt
- DOCSS/홈페이지-보청기.md (homepage_topic) <- docs/홈페이지-보청기.txt
- DOCSS/홈페이지-비중격만곡증.md (homepage_topic) <- docs/홈페이지-비중격만곡증.txt
- DOCSS/홈페이지-셔틀버스 및 오시는길.md (homepage_topic) <- docs/홈페이지-셔틀버스 및 오시는길.txt
- DOCSS/홈페이지-소아중이염.md (homepage_topic) <- docs/홈페이지-소아중이염.txt
- DOCSS/홈페이지-알레르기비염.md (homepage_topic) <- docs/홈페이지-알레르기비염.txt
- DOCSS/홈페이지-어지러움증.md (homepage_topic) <- docs/홈페이지-어지러움증.txt
- DOCSS/홈페이지-외래진료안내.md (homepage_topic) <- docs/홈페이지-외래진료안내.txt
- DOCSS/홈페이지-의료진 상세정보.md (doctor_detail) <- docs/홈페이지-의료진 상세정보.txt
- DOCSS/홈페이지-의료진 정보.md (doctor_info) <- docs/홈페이지-의료진 정보.txt
- DOCSS/홈페이지-이명.md (homepage_topic) <- docs/홈페이지-이명.txt
- DOCSS/홈페이지-입퇴원 안내.md (homepage_topic) <- docs/홈페이지-입퇴원 안내.txt
- DOCSS/홈페이지-축농증.md (homepage_topic) <- docs/홈페이지-축농증.txt
- DOCSS/홈페이지-침샘.md (homepage_topic) <- docs/홈페이지-침샘.txt
- DOCSS/홈페이지-코물혹.md (homepage_topic) <- docs/홈페이지-코물혹.txt
- DOCSS/홈페이지-편도.md (homepage_topic) <- docs/홈페이지-편도.txt
- DOCSS/홈페이지-후각장애.md (homepage_topic) <- docs/홈페이지-후각장애.txt
- DOCSS/홈페이지-FAQ.md (faq) <- docs/홈페이지-FAQ.txt

## 재생성 방법

```powershell
cd C:\Users\OCSEMR\patient-ai-bot
node scripts\build_docss.js
```
