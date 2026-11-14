import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, today, shiftDate, validate, available, estimate, isAppointment } from '../model.mjs';

test('시연 데이터와 서울 기준 날짜 계산', () => {
  assert.ok(seed().every(isAppointment));
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(estimate(seed()[0]), '14:45');
});
test('마감 시간과 기존 예약을 차단하되 자신의 예약 변경은 허용', () => {
  const appointments = seed();
  const draft = { ...appointments[0] };
  assert.ok(!available(draft, appointments).includes('14:30'));
  assert.ok(!available(draft, appointments).includes('15:00'));
  assert.equal(validate(draft, appointments, draft.id), '');
  assert.notEqual(validate(draft, appointments), '');
});
test('다른 병원이라도 같은 시간에 환자 예약을 중복 생성하지 않음', () => {
  const appointments = seed();
  const draft = { ...appointments[0], hospitalId: 'maeum', doctor: '박○○' };
  assert.match(validate(draft, appointments), /다른 예약/);
});
test('과거 날짜, 잘못된 담당의, 미선택 시간은 거절', () => {
  const draft = { ...seed()[0], time: '13:30' };
  assert.equal(validate(draft, []), '');
  assert.notEqual(validate({ ...draft, date: shiftDate(today(), -1) }, []), '');
  assert.notEqual(validate({ ...draft, doctor: '없는 의사' }, []), '');
  assert.notEqual(validate({ ...draft, time: '' }, []), '');
});
test('취소한 시간은 다시 예약할 수 있음', () => {
  const appointments = seed();
  appointments[0].status = 'cancelled';
  assert.equal(validate({ ...appointments[0] }, appointments), '');
});
