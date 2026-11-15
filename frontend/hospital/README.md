# MediQueue 프론트엔드 (병원용)
- 빌드 도구 없이 HTML/CSS/JavaScript로 작성
- 하나의 페이지가 화면 폭에 따라 PC(사이드바 + 표)와 모바일(하단 탭 + 카드)로 바뀜(768px 기준으로 함).

## 사용하는 API
- 대시보드: `GET /api/appointments`, `GET /api/doctors/:doctorId/queue`, `PATCH /api/queue-entries/:id/status`(진료 시작·완료), `POST /api/queue-entries/:id/call`(호출), `POST /api/queue-entries/:id/disappear`(부재), `POST /api/queue-entries/:id/return`(복귀)
- 예약 관리: `GET /api/appointments`, `GET /api/doctors/:doctorId/queue`(예상 시작), `PATCH /api/appointments/:id`(변경), `DELETE /api/appointments/:id`(취소)
