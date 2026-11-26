import test from 'node:test';
import assert from 'node:assert/strict';
import { today, shiftDate, nowTime, splitKst, toIso, fromApi, estimateFromQueue, available, validate, isCheckedIn } from '../model.mjs';

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

test('서버 예약을 화면 형식으로 변환', () => {
  const item = fromApi(apiAppointment());
  assert.equal(item.hospitalId, 'onyu');
  assert.equal(item.time, '14:00');
  assert.equal(item.status, 'active');
  assert.equal(fromApi(apiAppointment({ status: 'cancelled' })).status, 'cancelled');
  assert.equal(fromApi(apiAppointment({ queueEntry: { status: 'completed' } })).status, 'completed');
  assert.equal(fromApi(apiAppointment({ queueEntry: { status: 'no_show' } })).status, 'noshow');
  assert.ok(isCheckedIn(fromApi(apiAppointment({ queueEntry: { status: 'checked_in', queuePosition: 2 } }))));
  // 화면에 등록되지 않은 의사는 진료과 이름으로 표시
  const other = fromApi(apiAppointment({ doctorId: '4', doctor: { id: '4', displayName: '가상 의사 04', department: '소아과' } }));
  assert.equal(other.hospitalId, null);
  assert.match(other.hospitalName, /소아과/);
});

test('대기열 응답에서 예상 시각 추출', () => {
  assert.deepEqual(estimateFromQueue({ estimatedStartTime: '2026-11-10T05:45:00.000Z', delayMinutes: 15, queuePosition: 3 }), { start: '14:45', delay: 15, position: 3 });
  assert.equal(estimateFromQueue(undefined), null);
});

test('다른 환자가 예약한 시간은 마감, 변경 중인 내 예약은 제외', () => {
  const booked = [fromApi(apiAppointment({ scheduledAt: toIso(tomorrow(), '13:30') }))];
  assert.ok(!available(draft(), booked).includes('13:30'));
  assert.ok(available(draft(), booked, '100').includes('13:30'));
  assert.ok(available(draft({ doctorId: '23', hospitalId: 'maeum' }), booked).includes('13:30')); // 다른 의사
  const cancelled = [fromApi(apiAppointment({ scheduledAt: toIso(tomorrow(), '13:30'), status: 'cancelled' }))];
  assert.ok(available(draft(), cancelled).includes('13:30')); // 취소된 시간은 다시 예약 가능
});

test('오늘은 지난 시간을 예약할 수 없음', () => {
  const at1400 = new Date(`${today()}T14:00:00+09:00`);
  const slots = available(draft({ date: today() }), [], null, at1400);
  assert.deepEqual(slots, ['14:30', '15:00', '15:30']);
  assert.equal(nowTime(at1400), '14:00');
});

test('입력 검증: 과거 날짜, 잘못된 담당의, 미선택 시간, 내 예약 중복', () => {
  assert.equal(validate(draft(), {}), '');
  assert.notEqual(validate(draft({ date: shiftDate(today(), -1) }), {}), '');
  assert.notEqual(validate(draft({ doctorId: '999' }), {}), '');
  assert.notEqual(validate(draft({ time: '' }), {}), '');
  const mine = [fromApi(apiAppointment({ id: '7', doctorId: '23', scheduledAt: toIso(tomorrow(), '13:30') }))];
  assert.match(validate(draft(), { mine }), /다른 예약/); // 다른 병원이라도 같은 시간 중복 금지
  assert.equal(validate(draft(), { mine }, '7'), '');
});
