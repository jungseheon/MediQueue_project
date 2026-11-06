# MediQueue_Project
실시간 예상 대기 시간 안내 기반 병원 예약 관리 시스템

## 주요 기능
- EWMA(지수 가중 이동 평균) 방식에 따른 진료 소요 시간에 대한 동적 보정한 대기 시간 제공
- 실제 진료 진행 상태 반영한 대기 시간 제공
- 개인별 진료 지연 반영한 대기시간 제공
- 실시간 알림 제공

> 숭실대 오픈소스기반기초설계 7조
> **팀원**
> 정세헌(jungseheon)
> 임지수(jisuyim)
> 양윤서(yunseo4002)
> 김태연(taetaeris)

## 기술 스택
- 런타임·언어: Node.js, TypeScript
- 프론트엔드: 
- 백엔드: Express 5 기반 REST API
- 데이터베이스: PostgreSQL
- ORM·DB 연결: Prisma 7, @prisma/adapter-pg, pg
- 개발·빌드: tsx (개발 서버 실행), tsc (빌드)
- 기타: dotenv (환경변수 관리), cors (CORS 처리)

## 실행 방법
### 1. 환경 변수 설정
~~~bash
cp .env.example .env
//이후 .env에서 PASSWORD 변경
~~~
.env 파일에는 비밀번호가 포홤되므로 Git에 커밋하지 않는다.

### 2. 의존성 설치 및 데이터베이스 실행
~~~sh
npm install
docker compose up -d db
~~~

### 3. 데이터베이스 스키마 반영
~~~sh
npm run db:push
~~~

### 4. 개발 서버 실행
~~~sh
npm run dev
~~~
서버는 기본적으로 http://localhost:3000 에서 실행된다.

#### DB연결 확인
~~~sh
curl http://localhost:3000/health
~~~

### 5. 종료
- 개발 서버 종료: 실행 중인 터미널에서 'Ctrl+C'
- PostgreSQL 컨테이너:
~~~sh
docker compose stop db
~~~

### 6. 프로젝트 빌드 및 실행
~~~sh
npm run build
npm start
~~~
cf. 현재 'npm test'는 테스트 러너가 설정되어있지 않아 "테스트 미지정 오류" 발생한다.

## GitHUB 협업 규칙
모든 작업은 main 브랜치에 직접 푸시하지 않고, 기능별 브랜치를 파서 Pull Request(PR)로 진행

1. 최신 main 코드 받기
~~~
git checkout main
git pull origin main
~~~

2. 새로운 기능 브랜치 생성 및 이동
~~~
git checkout -b feat/기능이름 (예: feat/login, feat/dashboard)
~~~

3. 코드 작업 후 커밋
~~~
git add .
git commit -m "feat: 구현한 기능 설명"
~~~

4. 본인의 기능 브랜치로 푸시
~~~
git push origin feat/기능이름
~~~

5. GitHub 웹페이지 접속하여 main 브랜치로 Pull Request (PR) 작성
   -> 본인 제외 1인 리뷰 후 Merge 진행


## API
| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/health` | 서버와 DB 연결 상태 확인. 성공 시 `200`, DB 연결 실패 시 `503` |
| GET | `/api/appointments` | 예약 목록. `doctorId`, `patientId`, `status` 필터 선택 가능 |
| GET | `/api/appointments/:id` | 예약 상세 |
| POST | `/api/appointments` | 예약 생성 |
| PATCH | `/api/appointments/:id` | 예약 일시, 의사, 환자, 상태 수정. 변경할 필드만 전달 |
| DELETE | `/api/appointments/:id` | 예약 취소. 행을 삭제하지 않고 상태를 `cancelled`로 변경 |
| GET | `/api/doctors/:doctorId/queue` | 의사 대기열과 예상 시작 시각·대기시간 조회 |

### 요청 예시

DB 연결 상태:

```sh
curl -i http://localhost:3000/health
```

예약 목록 조회. 필터는 필요한 것만 사용할 수 있습니다.

```sh
curl -i 'http://localhost:3000/api/appointments?doctorId=1&patientId=1&status=booked'
```

예약 생성. `doctorId`와 `patientId`는 DB에 존재하는 ID로 바꿉니다.

```sh
curl -i -X POST http://localhost:3000/api/appointments \
  -H 'Content-Type: application/json' \
  --data '{"doctorId":"1","patientId":"1","scheduledAt":"2030-01-15T09:00:00+09:00"}'
```

예약 수정과 취소:

```sh
curl -i -X PATCH http://localhost:3000/api/appointments/예약ID \
  -H 'Content-Type: application/json' \
  --data '{"scheduledAt":"2030-01-15T10:00:00+09:00"}'
curl -i -X DELETE http://localhost:3000/api/appointments/예약ID
```

의사별 대기열 조회:

```sh
curl -i http://localhost:3000/api/doctors/의사ID/queue
```

대기열 응답은 `checked_in`·`called` 상태 항목만 포함하며, 각 항목에 `estimatedStartTime`, `estimatedWaitMinutes`, `delayMinutes`를 반환합니다. EWMA 통계가 없으면 예측 진료시간에 10분을 사용합니다.

모든 응답은 JSON입니다. 예약 ID는 요청에서 문자열 또는 안전한 정수로 전달할 수 있고, 응답에서는 문자열로 반환합니다. 잘못된 입력은 `400`, 없는 예약·의사는 `404`, 허용되지 않은 상태 변경은 `409`를 반환합니다.
