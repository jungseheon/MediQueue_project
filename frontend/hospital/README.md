# MediQueue 프론트엔드 (병원용)
- 빌드 도구 없이 HTML/CSS/JavaScript로 작성
- 하나의 페이지가 화면 폭에 따라 PC(사이드바 + 표)와 모바일(하단 탭 + 카드)로 바뀜(768px 기준으로 함).
- 백엔드(`http://localhost:3000`, `js/api.js`의 `API_BASE`)와 연동
- 대시보드는 선택한 의사의 SSE(`GET /api/doctors/:doctorId/stream`)를 구독해 진료 시작·완료 시 바로 갱신하고, 그 밖의 변경(호출·부재·복귀·체크인)은 30초마다 다시 불러온다

## 실행
저장소 최상위에서 `npm run dev`로 API 서버를 켠 뒤 `dashboard.html`(대기열 대시보드) 또는 `appointments.html`(예약 관리), `settings.html`(예측 알고리즘 설정)을 브라우저로 연다.

## 사용하는 API
- 대시보드: `GET /api/appointments`, `GET /api/doctors/:doctorId/queue`, `GET /api/doctors/:doctorId/stream`(SSE), `GET /api/algorithm-config/:doctorId`(예상 진료시간·지연 알림 기준), `PATCH /api/queue-entries/:id/status`(진료 시작·완료), `POST /api/queue-entries/:id/call`(호출), `POST /api/queue-entries/:id/disappear`(부재), `POST /api/queue-entries/:id/return`(복귀)
- 예약 관리: `GET /api/appointments`, `GET /api/doctors/:doctorId/queue`(예상 시작), `PATCH /api/appointments/:id`(변경), `DELETE /api/appointments/:id`(취소)
- 알고리즘 설정: `GET /api/algorithm-config/:doctorId`(조회), `PUT /api/algorithm-config/:doctorId`(저장), `GET /api/appointments`(모니터링용 완료 진료 기록)

## 현재 진료 환자 카드
- 경과 시간: 진료 시작(`startedAt`)부터 1초마다 갱신
- 예상 진료시간: 알고리즘 설정의 초진/재진 기본시간 (같은 의사에게 완료 이력이 있으면 재진)
- 지연 표시: 예약보다 늦게 시작한 시간, 예상 진료시간을 넘긴 시간
- 대기 목록의 "알림 발송" 표시는 설정의 지연 알림 기준(`delayThreshold`)을 따른다

## 백엔드 API가 없어 비워 둔 부분
- 알고리즘 설정의 현재 EWMA: 조회 API가 없어 `—`로 표시
- 알림 채널(푸시·문자·알림톡): 저장할 필드가 없어 비활성화
