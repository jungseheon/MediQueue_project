import test from 'node:test';
import assert from 'node:assert/strict';
import { today, shiftDate, nowTime, splitKst, toIso, buildHospitals, searchHospitals, fromApi, estimateFromWait, applyWait, available, validate, isCheckedIn } from '../model.mjs';

// 의사 목록 API 응답 형식 (dump.sql 일부)
const doctors = [
  { id: '4', displayName: '가상 의사 04', department: '소아과' },
  { id: '13', displayName: '가상 의사 08', department: '정신건강의학과' },
  { id: '23', displayName: '가상 의사 18', department: '정신건강의학과' },
  { id: '2', displayName: '가상 의사 2', department: '내과' },
  { id: '3', displayName: '가상 의사 03', department: '내과' },
];
const hospitals = buildHospitals(doctors);

const tomorrow = () => shiftDate(today(), 1);
const apiAppointment = (overrides = {}) => ({
  id: '100', doctorId: '13', patientId: '4', scheduledAt: toIso(tomorrow(), '14:00'), status: 'booked',
  doctor: { id: '13', displayName: '가상 의사 08', department: '정신건강의학과' },
  patient: { id: '4', displayName: '양윤서' }, queueEntry: null, ...overrides,
});
const draft = (overrides = {}) => ({ hospitalId: 'onyu', doctorId: '13', date: tomorrow(), time: '13:30', ...overrides });

test('서울 기준 날짜 계산과 ISO 변환', () => {
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.deepEqual(splitKst('2026-11-10T00:30:00.000Z'), { date: '2026-11-10', time: '09:30' });
  assert.deepEqual(splitKst('2026-11-09T15:10:00.000Z'), { date: '2026-11-10', time: '00:10' }); // UTC 전날 → 서울 다음날
  assert.equal(toIso('2026-11-10', '14:30'), '2026-11-10T14:30:00+09:00');
});

test('의사 목록으로 병원 목록 구성', () => {
  assert.deepEqual(hospitals.map(item => item.id), ['onyu', 'maeum', 'dept:내과', 'dept:소아과']);
  assert.deepEqual(hospitals[0].doctors, [{ id: '13', name: '가상 의사 08', department: '정신건강의학과' }]);
  // 병원에 연결되지 않은 의사는 진료과별 협력 병원으로 묶음
  const internal = hospitals.find(item => item.id === 'dept:내과');
  assert.equal(internal.name, '내과 협력 병원');
  assert.deepEqual(internal.doctors.map(doctor => doctor.id), ['2', '3']);
  // DB에 없는 의사만 연결된 병원은 숨김
  assert.deepEqual(buildHospitals(doctors.filter(doctor => doctor.id !== '23')).map(item => item.id), ['onyu', 'dept:내과', 'dept:소아과']);
  assert.deepEqual(buildHospitals([]), []);
});

test('병원명·지역·진료과·의사 이름으로 검색', () => {
  assert.deepEqual(searchHospitals(hospitals, '마포').map(item => item.id), ['maeum']);
  assert.deepEqual(searchHospitals(hospitals, '소아').map(item => item.id), ['dept:소아과']);
  assert.deepEqual(searchHospitals(hospitals, '가상 의사 18').map(item => item.id), ['maeum']);
  assert.equal(searchHospitals(hospitals, '').length, hospitals.length);
  assert.deepEqual(searchHospitals(hospitals, '없는병원'), []);
});

test('서버 예약을 화면 형식으로 변환', () => {
  const item = fromApi(apiAppointment(), hospitals);
  assert.equal(item.hospitalId, 'onyu');
  assert.equal(item.time, '14:00');
  assert.equal(item.status, 'active');
  assert.equal(fromApi(apiAppointment({ status: 'cancelled' })).status, 'cancelled');
  assert.equal(fromApi(apiAppointment({ queueEntry: { status: 'completed' } })).status, 'completed');
  assert.equal(fromApi(apiAppointment({ queueEntry: { status: 'no_show' } })).status, 'noshow');
  assert.ok(isCheckedIn(fromApi(apiAppointment({ queueEntry: { status: 'checked_in', queuePosition: 2 } }))));
  // 병원에 연결되지 않은 의사의 예약은 진료과 협력 병원으로 표시 (변경 가능)
  const other = fromApi(apiAppointment({ doctorId: '4', doctor: { id: '4', displayName: '가상 의사 04', department: '소아과' } }), hospitals);
  assert.equal(other.hospitalId, 'dept:소아과');
  assert.equal(other.hospitalName, '소아과 협력 병원');
  // 병원 목록이 없으면 진료과 이름으로 대신 표시
  const unknown = fromApi(apiAppointment());
  assert.equal(unknown.hospitalId, null);
  assert.match(unknown.hospitalName, /정신건강의학과/);
});

const waiting = { queuePosition: 3, peopleAhead: 2, isCalled: false, estimatedStartTime: '2026-11-10T05:45:00.000Z', estimatedWaitMinutes: 20, delayMinutes: 15, isDelayed: true };

test('대기 정보 응답에서 예상 시각 추출', () => {
  assert.deepEqual(estimateFromWait(waiting), { start: '14:45', delay: 15, position: 3, ahead: 2, called: false, delayed: true });
  assert.equal(estimateFromWait({ ...waiting, isCalled: true }).called, true);
  assert.equal(estimateFromWait(null), null);
});

test('대기 정보로 체크인 이후 상태 변화 반영', () => {
  const item = fromApi(apiAppointment({ queueEntry: { status: 'checked_in', queuePosition: 3 } }), hospitals);
  const waitResponse = (queueStatus, data = null) => ({ appointmentId: '100', appointmentStatus: 'booked', queueStatus, waiting: data });

  const waitingItem = applyWait(item, waitResponse('checked_in', waiting));
  assert.equal(waitingItem.estimate.ahead, 2);
  assert.equal(waitingItem.status, 'active');

  const inProgress = applyWait(item, waitResponse('in_progress'));
  assert.equal(inProgress.queueStatus, 'in_progress');
  assert.equal(inProgress.estimate, null);
  assert.ok(isCheckedIn(inProgress));

  assert.equal(applyWait(item, waitResponse('completed')).status, 'completed');
  assert.equal(applyWait(item, waitResponse('no_show')).status, 'noshow');
});

test('다른 환자가 예약한 시간은 마감, 변경 중인 내 예약은 제외', () => {
  const booked = [fromApi(apiAppointment({ scheduledAt: toIso(tomorrow(), '13:30') }), hospitals)];
  assert.ok(!available(draft(), booked).includes('13:30'));
  assert.ok(available(draft(), booked, '100').includes('13:30'));
  assert.ok(available(draft({ doctorId: '23', hospitalId: 'maeum' }), booked).includes('13:30')); // 다른 의사
  const cancelled = [fromApi(apiAppointment({ scheduledAt: toIso(tomorrow(), '13:30'), status: 'cancelled' }), hospitals)];
  assert.ok(available(draft(), cancelled).includes('13:30')); // 취소된 시간은 다시 예약 가능
});

test('오늘은 지난 시간을 예약할 수 없음', () => {
  const at1400 = new Date(`${today()}T14:00:00+09:00`);
  const slots = available(draft({ date: today() }), [], null, at1400);
  assert.deepEqual(slots, ['14:30', '15:00', '15:30']);
  assert.equal(nowTime(at1400), '14:00');
});

test('입력 검증: 과거 날짜, 잘못된 담당의, 미선택 시간, 내 예약 중복', () => {
  assert.equal(validate(draft(), { hospitals }), '');
  assert.notEqual(validate(draft({ date: shiftDate(today(), -1) }), { hospitals }), '');
  assert.notEqual(validate(draft({ doctorId: '999' }), { hospitals }), '');
  assert.notEqual(validate(draft({ doctorId: '23' }), { hospitals }), ''); // 다른 병원의 의사
  assert.notEqual(validate(draft({ time: '' }), { hospitals }), '');
  assert.notEqual(validate(draft(), {}), ''); // 의사 목록을 아직 못 받음
  const mine = [fromApi(apiAppointment({ id: '7', doctorId: '23', scheduledAt: toIso(tomorrow(), '13:30') }), hospitals)];
  assert.match(validate(draft(), { mine, hospitals }), /다른 예약/); // 다른 병원이라도 같은 시간 중복 금지
  assert.equal(validate(draft(), { mine, hospitals }, '7'), '');
});
