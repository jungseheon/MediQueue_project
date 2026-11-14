# 환자용 프론트엔드

첨부된 환자용 디자인의 흑백 카드, PC 사이드바, 모바일 하단 메뉴를 기반으로 구현했습니다. 기존 Express/Prisma 백엔드와 별도로 실행하며 추가 패키지나 DB 설정이 필요하지 않습니다. Node.js 20 이상을 사용하세요.

## 실행

저장소 최상위 폴더에서 `npm run dev:patient` 실행 후 http://localhost:5173 에 접속합니다. npm이 없는 환경에서는 `node frontend/server.mjs`로 실행할 수 있습니다. 종료는 Ctrl+C입니다. 포트 변경은 PowerShell에서 `$env:PATIENT_PORT=5174` 설정 후 실행합니다.

## 시연 순서

1. 홈에서 오늘의 예약 및 예상 진료 시각 확인
2. 병원 검색·예약에서 `마포` 검색 후 마음봄 선택
3. 진료 유형, 담당의, 오늘 이후 날짜와 마감되지 않은 시간 선택
4. 예약 내용 확인 → 예약 확정 → 내 예약에서 결과 확인
5. 예약 변경 후 시간 변경 및 확정, 예약 취소 후 확정
6. 새로고침 후 예약 내역과 알림 설정 유지 확인
7. 브라우저 폭을 390px로 줄여 하단 메뉴와 세로 레이아웃 확인

검색 결과 없음, 빈 예약 목록, 마감 시간, 중복 예약, 과거 날짜를 처리합니다. 예약 확인 및 취소 창은 Escape로 닫을 수 있습니다. 초기 시연 날짜는 서울 기준 오늘에 맞춰 생성됩니다. 오늘은 시간 흐름에 관계없이 시연용 시간대를 제공합니다.

## 파일 및 데이터

- `index.html`: 공통 메뉴 및 접근성 기본 구조
- `app.js`: 공통 카드, 화면 전환, 검색·예약·변경·취소 이벤트
- `model.mjs`: 임시 병원 데이터, 예약 검증, 날짜와 예상 시각 계산
- `style.css`: PC·태블릿·모바일 반응형
- `server.mjs`: 로컬 정적 파일 서버

예약과 알림 설정은 브라우저 localStorage의 `mediqueue-patient-v1`에 저장됩니다. 초기화하려면 개발자 도구의 Application → Local Storage에서 해당 키를 삭제하고 새로고침하세요. 새 예약은 임시 데이터로만 저장되며 실제 접수·알림 전송·실시간 진료 정보 갱신은 없습니다. 날짜가 지난 활성 예약은 지난 진료 탭에 표시됩니다. 백엔드 연동 시 `seed` 및 localStorage 입출력을 API 호출로 교체하고, 예상 진료 정보는 서버 응답으로 연결하세요.

## 검증

`npm run test:patient`로 중복 예약, 마감 시간, 변경 시 자기 예약 제외, 취소 후 재예약, 과거 날짜 및 입력 검증을 확인합니다. 백엔드 테스트와 독립적으로 실행됩니다.

## 팀 저장소에 반영

현재 변경은 로컬에만 있으며 브랜치 생성·커밋·원격 푸시는 하지 않았습니다. 팀과 확인 후 저장소 최상위에서 아래 순서로 작업하세요.

```powershell
git switch -c feature/patient-frontend
git add frontend package.json
git commit -m "feat: implement patient frontend demo"
git push -u origin feature/patient-frontend
```

GitHub에서 Compare & pull request를 눌러 팀의 기본 브랜치로 PR을 만드세요. 직접 push 권한이 없다면 본인 계정으로 Fork한 저장소에 push하고 원본 저장소로 PR을 보냅니다. PR에는 세 화면, 반응형, localStorage 시연 예약, `npm run test:patient` 결과와 백엔드 미연동 범위를 적으세요.
