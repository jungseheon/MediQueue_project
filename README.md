# MediQueue_Project
숭실대 오픈소스기반기초설계 7조

팀원:
정세헌(jungseheon) 
임지수(jisuyim) 
양윤서(yunseo4002) 
김태연(taetaeris)


모든 작업은 main 브랜치에 직접 푸시하지 않고, 기능별 브랜치를 파서 Pull Request(PR)로 진행

1. 최신 main 코드 받기
   git checkout main
   git pull origin main

2. 새로운 기능 브랜치 생성 및 이동
   git checkout -b feat/기능이름 (예: feat/login, feat/dashboard)

3. 코드 작업 후 커밋
   git add .
   git commit -m "feat: 구현한 기능 설명"

4. 본인의 기능 브랜치로 푸시
   git push origin feat/기능이름

5. GitHub 웹페이지 접속하여 main 브랜치로 Pull Request (PR) 작성
   -> 팀장/팀원 리뷰 후 Merge 진행

## 예약 API 서버

`.env`에 PostgreSQL 접속 문자열을 `DATABASE_URL`로 설정한 뒤 DB를 실행하고 스키마를 반영합니다.

```sh
npm install
docker compose up -d db
npm run db:push
npm run dev
```

서버 기본 주소는 `http://localhost:3000`이며, 예약 API는 `/api/appointments`에서 제공합니다.

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/api/appointments` | 예약 목록 (의사, 환자, 상태 필터 지원) |
| GET | `/api/appointments/:id` | 예약 상세 |
| POST | `/api/appointments` | 예약 생성 |
| PATCH | `/api/appointments/:id` | 예약 일시, 의사, 환자, 상태 수정 |
| DELETE | `/api/appointments/:id` | 예약 취소 |

예약 생성 본문 예시: `{"doctorId":"1","patientId":"1","scheduledAt":"2026-10-28T09:00:00+09:00"}`. ID는 문자열 또는 안전한 정수로 전달하며, 응답에서는 문자열로 반환합니다.