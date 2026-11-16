# MediQueue 프론트엔드 (병원용)
- 빌드 도구 없이 HTML/CSS/JavaScript로 작성
- 하나의 페이지가 화면 폭에 따라 PC(사이드바 + 표)와 모바일(하단 탭 + 카드)로 바뀜(768px 기준으로 함).
- 백엔드(`http://localhost:3000`, `js/api.js`의 `API_BASE`)와 연동
- 대시보드는 선택한 의사의 SSE(`GET /api/doctors/:doctorId/stream`)를 구독해 진료 시작·완료 시 바로 갱신하고, 그 밖의 변경(호출·부재·복귀·체크인)은 30초마다 다시 불러온다

## 실행
저장소 최상위에서 `npm run dev`로 API 서버를 켠 뒤 `dashboard.html`(대기열 대시보드) 또는 `appointments.html`(예약 관리)을 브라우저로 연다.

## 사용하는 API
- 대시보드: `GET /api/appointments`, `GET /api/doctors/:doctorId/queue`, `GET /api/doctors/:doctorId/stream`(SSE), `PATCH /api/queue-entries/:id/status`(진료 시작·완료), `POST /api/queue-entries/:id/call`(호출), `POST /api/queue-entries/:id/disappear`(부재), `POST /api/queue-entries/:id/return`(복귀)
- 예약 관리: `GET /api/appointments`, `GET /api/doctors/:doctorId/queue`(예상 시작), `PATCH /api/appointments/:id`(변경), `DELETE /api/appointments/:id`(취소)
