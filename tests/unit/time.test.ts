import { describe, it, expect } from "vitest";
import { getKstDayRange, isSameKstDay } from "../../src/utils/time";

// KST = UTC+9: UTC 00:00 = KST 09:00, UTC 15:00 = KST 00:00(다음날)

describe("getKstDayRange", () => {
  it("UTC 07:00 (KST 16:00)이 속한 KST 하루의 시작·끝 반환", () => {
    // KST 2026-11-08: UTC 2026-11-07 15:00 ~ 2026-11-08 15:00
    const date = new Date("2026-11-08T07:00:00.000Z"); // KST 11/8 16:00
    const { start, end } = getKstDayRange(date);
    expect(start.toISOString()).toBe("2026-11-07T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-08T15:00:00.000Z");
  });

  it("KST 자정 정각(UTC 15:00)은 새 날의 시작", () => {
    const date = new Date("2026-11-08T15:00:00.000Z"); // KST 11/9 00:00
    const { start } = getKstDayRange(date);
    expect(start.toISOString()).toBe("2026-11-08T15:00:00.000Z");
  });

  it("KST 자정 1초 전(UTC 14:59:59)은 이전 날에 포함", () => {
    const date = new Date("2026-11-08T14:59:59.000Z"); // KST 11/8 23:59:59
    const { start } = getKstDayRange(date);
    expect(start.toISOString()).toBe("2026-11-07T15:00:00.000Z");
  });

  it("start와 end의 간격은 정확히 24시간", () => {
    const date = new Date("2026-11-08T07:00:00.000Z");
    const { start, end } = getKstDayRange(date);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("isSameKstDay", () => {
  it("KST 같은 날: UTC 07:00(KST 16:00)과 UTC 14:00(KST 23:00)은 같은 날", () => {
    const a = new Date("2026-11-08T07:00:00.000Z"); // KST 11/8 16:00
    const b = new Date("2026-11-08T14:00:00.000Z"); // KST 11/8 23:00
    expect(isSameKstDay(a, b)).toBe(true);
  });

  it("KST 자정을 경계로 다른 날 판별: UTC 14:59 vs UTC 15:00", () => {
    const a = new Date("2026-11-08T14:59:00.000Z"); // KST 11/8 23:59
    const b = new Date("2026-11-08T15:00:00.000Z"); // KST 11/9 00:00
    expect(isSameKstDay(a, b)).toBe(false);
  });

  it("UTC 기준 같은 날이라도 KST가 다르면 false", () => {
    // UTC 11/8 00:00(KST 11/8 09:00)과 UTC 11/8 16:00(KST 11/9 01:00)
    const a = new Date("2026-11-08T00:00:00.000Z");
    const b = new Date("2026-11-08T16:00:00.000Z");
    expect(isSameKstDay(a, b)).toBe(false);
  });

  it("동일한 Date 객체는 항상 같은 날", () => {
    const d = new Date("2026-11-08T10:00:00.000Z");
    expect(isSameKstDay(d, d)).toBe(true);
  });
});
