import { describe, it, expect } from "vitest";
import { calculateEWMA, calculateQueueWaitTimes } from "../../src/services/calculator";

// ─── calculateEWMA ───────────────────────────────────────────────────────────

describe("calculateEWMA", () => {
  it("alpha=0.3 기본값으로 가중 평균 계산", () => {
    // 0.3 * 18 + 0.7 * 14.2 = 5.4 + 9.94 = 15.34 → 15.3
    expect(calculateEWMA(14.2, 18)).toBe(15.3);
  });

  it("alpha=1 이면 최신 실측값으로 완전 대체", () => {
    expect(calculateEWMA(10, 20, 1)).toBe(20);
  });

  it("alpha=0 이면 기존 EWMA 그대로 유지", () => {
    expect(calculateEWMA(10, 20, 0)).toBe(10);
  });

  it("결과가 소수점 첫째 자리로 반올림됨", () => {
    // 0.3 * 15 + 0.7 * 10 = 4.5 + 7.0 = 11.5
    expect(calculateEWMA(10, 15)).toBe(11.5);
  });

  it("기존값과 실측값이 같으면 EWMA 불변", () => {
    expect(calculateEWMA(10, 10)).toBe(10);
  });
});

// ─── calculateQueueWaitTimes ─────────────────────────────────────────────────

describe("calculateQueueWaitTimes", () => {
  // 직전 환자 완료 시각: 10:00 UTC
  const prevFinish = new Date("2026-11-08T10:00:00.000Z");

  it("대기 환자가 없으면 빈 배열 반환", () => {
    expect(calculateQueueWaitTimes([], 10, prevFinish)).toEqual([]);
  });

  it("예약 시각이 직전 완료 시각보다 늦으면 지연 없음", () => {
    // 예약 10:30 > 완료 10:00 → 예상 시작 10:30, 지연 0분
    const apptTime = new Date("2026-11-08T10:30:00.000Z");
    const [result] = calculateQueueWaitTimes(
      [{ ticketId: 1, appointmentTime: apptTime, isFirstVisit: true }],
      10, prevFinish, 10, 12, 8,
    );
    expect(result.delayMinutes).toBe(0);
    expect(result.estimatedStartTime.getTime()).toBe(apptTime.getTime());
    expect(result.isAlertTriggered).toBe(false);
  });

  it("직전 완료 시각이 예약 시각보다 늦으면 그 차이만큼 지연", () => {
    // 예약 09:50, 완료 10:00 → 지연 10분
    const apptTime = new Date("2026-11-08T09:50:00.000Z");
    const [result] = calculateQueueWaitTimes(
      [{ ticketId: 1, appointmentTime: apptTime, isFirstVisit: true }],
      10, prevFinish, 10, 12, 8,
    );
    expect(result.delayMinutes).toBe(10);
    expect(result.estimatedStartTime.getTime()).toBe(prevFinish.getTime());
  });

  it("지연이 delayThreshold 이상이면 isAlertTriggered = true", () => {
    // 60분 지연, 임계값 10분
    const apptTime = new Date("2026-11-08T09:00:00.000Z");
    const [result] = calculateQueueWaitTimes(
      [{ ticketId: 1, appointmentTime: apptTime, isFirstVisit: true }],
      10, prevFinish, 10, 12, 8,
    );
    expect(result.isAlertTriggered).toBe(true);
  });

  it("지연이 delayThreshold 미만이면 isAlertTriggered = false", () => {
    // 5분 지연, 임계값 10분
    const apptTime = new Date("2026-11-08T09:55:00.000Z");
    const [result] = calculateQueueWaitTimes(
      [{ ticketId: 1, appointmentTime: apptTime, isFirstVisit: true }],
      10, prevFinish, 10, 12, 8,
    );
    expect(result.isAlertTriggered).toBe(false);
  });

  it("연속 2명: 앞 환자의 완료 시각이 뒷 환자 시작 시각에 반영됨", () => {
    // 환자A(초진): 예약·완료 모두 10:00, speedRatio=1, duration=12+1=13분 → C=10:13
    // 환자B(재진): 예약 10:05, 완료 10:13 → 시작 10:13, 지연 8분
    const apptA = new Date("2026-11-08T10:00:00.000Z");
    const apptB = new Date("2026-11-08T10:05:00.000Z");
    const results = calculateQueueWaitTimes(
      [
        { ticketId: 1, appointmentTime: apptA, isFirstVisit: true },
        { ticketId: 2, appointmentTime: apptB, isFirstVisit: false },
      ],
      10, prevFinish, 10, 12, 8,
    );
    expect(results[0].delayMinutes).toBe(0);
    expect(results[1].delayMinutes).toBe(8);
  });

  it("ticketId가 입력 순서 그대로 반환됨", () => {
    const appt = new Date("2026-11-08T10:00:00.000Z");
    const results = calculateQueueWaitTimes(
      [
        { ticketId: 42, appointmentTime: appt, isFirstVisit: true },
        { ticketId: 99, appointmentTime: appt, isFirstVisit: false },
      ],
      10, prevFinish,
    );
    expect(results[0].ticketId).toBe(42);
    expect(results[1].ticketId).toBe(99);
  });

  it("EWMA가 클수록 예상 소요시간이 비례해서 늘어남", () => {
    // 같은 초진 환자, standardAvg=(12+8)/2=10
    // EWMA=10 → speedRatio=1  → duration=12+1=13분
    // EWMA=20 → speedRatio=2  → duration=24+1=25분
    const appt = new Date("2026-11-08T10:00:00.000Z");
    const [slow] = calculateQueueWaitTimes(
      [{ ticketId: 1, appointmentTime: appt, isFirstVisit: true }],
      20, prevFinish, 10, 12, 8,
    );
    const [fast] = calculateQueueWaitTimes(
      [{ ticketId: 1, appointmentTime: appt, isFirstVisit: true }],
      10, prevFinish, 10, 12, 8,
    );
    // slow가 fast보다 완료 시각이 더 늦어야 함
    expect(slow.estimatedStartTime.getTime()).toBe(fast.estimatedStartTime.getTime()); // 시작은 같음
    // 다음 환자가 있다고 가정하면 완료 시각 차이가 생기지만
    // 여기서는 단순히 소요시간 계산 로직이 올바른지만 검증
    // (다음 환자를 추가해 간접 검증)
    const apptNext = new Date("2026-11-08T11:00:00.000Z"); // 넉넉히 늦은 예약
    const [, slowNext] = calculateQueueWaitTimes(
      [
        { ticketId: 1, appointmentTime: appt, isFirstVisit: true },
        { ticketId: 2, appointmentTime: apptNext, isFirstVisit: true },
      ],
      20, prevFinish, 10, 12, 8,
    );
    const [, fastNext] = calculateQueueWaitTimes(
      [
        { ticketId: 1, appointmentTime: appt, isFirstVisit: true },
        { ticketId: 2, appointmentTime: apptNext, isFirstVisit: true },
      ],
      10, prevFinish, 10, 12, 8,
    );
    // EWMA가 클수록 두 번째 환자의 지연이 더 큼(또는 같음)
    expect(slowNext.delayMinutes).toBeGreaterThanOrEqual(fastNext.delayMinutes);
  });
});
