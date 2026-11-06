## DB속 테이블

---

**강조** : 기본키
*기울기* : 참조키
Attribute(저장해야할 Data type)

---

### 1. patients
- **id(BIGINT)**
    환자 고유 번호
- display_name(TEXT)
    환자 이름

### 2. doctors
- **id(BIGINT)**
    의사 고유 번호
- display_name(TEXT)
    의사 이름
- department(TEXT)
    진료과 이름만 저장
    ex. 소아과, 가정의학과, 이비인후과, 내과, 산부인과, 비뇨기과, 정형외과 ...

### 3. appointments
- **id(BIGINT)**
    예약 고유 번호
- *doctor_id(BIGINT)*
    의사 고유 번호
    doctors 테이블의 id 참조
- *patient_id(BIGINT)*
    환자 고유 번호
    patients 테이블의 id 참조
- scheduled_at(TIMESTAMPTZ)
    예약 시간
- status(enum)
    예약 상태
    - booked
    - cancelled

### 4. queue_entries
- **id(BIGINT)**
    대기 항목 고유 번호 (기본키)
- *appointment_id(BIGINT)*
    예약 고유 번호
    appointments 테이블의 id 참조, 예약당 대기 항목 하나
- queue_position(INTEGER)
    대기 순번
    진료중인 사람 0, 그 다음 1, 2, ...
- status(enum)
    예약에 대한 상태
    - booked : 예약 시간 전까지 환자 도착(check-in) 대기중인 상태
    - cancelled : 취소 상태로, appointments테이블의 cancelled인 entry
    - checked_in : 예약 시간 전 환자가 도착해 체크인을 한 상태
    - no_show : 예약 시간 5분 후 까지 환자가 check_in 안하면 자동으로 no_show 전환
    - disappeared : 체크인을 했지만, 순번이 되어도 진료받지 않는 상태로, 1회 순서 뒤로 미룸(최대 2회, 이후 no_show로 상태 전환)
    - inprogress : 진료가 진행 중인 상태
    - completed : 진료가 완료된 상태
- checked_in_at(TIMESTAMPTZ)
    환자 도착 시간
- called_at(TIMESTAMPTZ)
    환자 호출 시간
- started_at(TIMESTAMPTZ)
    진료 시작 시간
- completed_at(TIMESTAMPTZ)
    진료 완료 시간
    checked_in_at, called_at, started_at, completed_at은 각 단계의 시각이며, 아직 발생하지 않은 단계는 NULL

### 5. service_time_stats
- ***doctor_id(BIGINT)***
    의사 고유 번호
    doctors 테이블의 id 참조
- **service_type(enum)**
    진료 형태
    - 초진 (진료 기록 없을 때, 기본값)
    - 재진 (진료 기록 있을 때)
    - 검사
    (doctor_id, service_type) 복합 기본키
- ewma_minutes(NUMERIC(6,2))
    지수가중평균으로 구한 예상 대기 소요 시간
- sample_count(INTEGER)
    지수가중평균을 구할 때 사용한 진료 case 수
- updated_at(TIMESTAMPTZ)
    sample_count가 갱신된 시간