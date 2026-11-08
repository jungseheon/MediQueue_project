import { describe, it, expect } from "vitest";
import {
  parseId,
  parseDate,
  parseStatus,
  parseQueueStatus,
  parseIntInRange,
  parseBody,
} from "../../src/utils/parsers";
import { ApiError } from "../../src/errors/apiError";

// ─── parseId ─────────────────────────────────────────────────────────────────

describe("parseId", () => {
  it("양수 정수 문자열 → BigInt 반환", () => {
    expect(parseId("1", "id")).toBe(1n);
    expect(parseId("100", "id")).toBe(100n);
  });

  it("안전한 Number 타입도 허용", () => {
    expect(parseId(42, "id")).toBe(42n);
  });

  it("0 → 400 ApiError", () => {
    expect(() => parseId("0", "id")).toThrow(ApiError);
  });

  it("음수 → 400 ApiError", () => {
    expect(() => parseId("-1", "id")).toThrow(ApiError);
  });

  it("소수점 포함 문자열 → 400 ApiError", () => {
    expect(() => parseId("1.5", "id")).toThrow(ApiError);
  });

  it("비숫자 문자열 → 400 ApiError", () => {
    expect(() => parseId("abc", "id")).toThrow(ApiError);
  });

  it("PostgreSQL BIGINT 최댓값(9223372036854775807) 정상 파싱", () => {
    expect(parseId("9223372036854775807", "id")).toBe(9223372036854775807n);
  });

  it("BIGINT 최댓값 초과 → 400 ApiError", () => {
    expect(() => parseId("9223372036854775808", "id")).toThrow(ApiError);
  });
});

// ─── parseDate ───────────────────────────────────────────────────────────────

describe("parseDate", () => {
  it("ISO 8601 문자열 파싱", () => {
    const d = parseDate("2026-11-08T10:00:00.000Z", "scheduledAt");
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe("2026-11-08T10:00:00.000Z");
  });

  it("빈 문자열 → 400 ApiError", () => {
    expect(() => parseDate("", "scheduledAt")).toThrow(ApiError);
  });

  it("공백만 있는 문자열 → 400 ApiError", () => {
    expect(() => parseDate("   ", "scheduledAt")).toThrow(ApiError);
  });

  it("유효하지 않은 날짜 문자열 → 400 ApiError", () => {
    expect(() => parseDate("not-a-date", "scheduledAt")).toThrow(ApiError);
  });

  it("숫자 타입 → 400 ApiError", () => {
    expect(() => parseDate(12345, "scheduledAt")).toThrow(ApiError);
  });
});

// ─── parseStatus (AppointmentStatus) ─────────────────────────────────────────

describe("parseStatus", () => {
  it("'booked' → BOOKED", () => {
    expect(parseStatus("booked")).toBe("BOOKED");
  });

  it("'CANCELLED' (대문자) → CANCELLED", () => {
    expect(parseStatus("CANCELLED")).toBe("CANCELLED");
  });

  it("허용되지 않는 상태 → 400 ApiError", () => {
    expect(() => parseStatus("in_progress")).toThrow(ApiError);
    expect(() => parseStatus("no_show")).toThrow(ApiError);
    expect(() => parseStatus("unknown")).toThrow(ApiError);
  });
});

// ─── parseQueueStatus ────────────────────────────────────────────────────────

describe("parseQueueStatus", () => {
  const validStatuses = [
    "booked", "checked_in", "cancelled",
    "disappeared", "in_progress", "completed", "no_show",
  ];

  it.each(validStatuses)("'%s' → 대문자 QueueStatus", (status) => {
    expect(parseQueueStatus(status)).toBe(status.toUpperCase());
  });

  it("대소문자 무관하게 허용", () => {
    expect(parseQueueStatus("CHECKED_IN")).toBe("CHECKED_IN");
    expect(parseQueueStatus("Completed")).toBe("COMPLETED");
  });

  it("정의되지 않은 상태 → 400 ApiError", () => {
    expect(() => parseQueueStatus("called")).toThrow(ApiError);
    expect(() => parseQueueStatus("waiting")).toThrow(ApiError);
  });
});

// ─── parseIntInRange ─────────────────────────────────────────────────────────

describe("parseIntInRange", () => {
  it("범위 경계값 허용", () => {
    expect(parseIntInRange(1, "v", 1, 10)).toBe(1);
    expect(parseIntInRange(10, "v", 1, 10)).toBe(10);
  });

  it("정수 문자열도 허용", () => {
    expect(parseIntInRange("5", "v", 1, 10)).toBe(5);
  });

  it("범위 미만 → 400 ApiError", () => {
    expect(() => parseIntInRange(0, "v", 1, 10)).toThrow(ApiError);
  });

  it("범위 초과 → 400 ApiError", () => {
    expect(() => parseIntInRange(11, "v", 1, 10)).toThrow(ApiError);
  });

  it("소수 → 400 ApiError", () => {
    expect(() => parseIntInRange(1.5, "v", 1, 10)).toThrow(ApiError);
  });

  it("비숫자 문자열 → 400 ApiError", () => {
    expect(() => parseIntInRange("abc", "v", 1, 10)).toThrow(ApiError);
  });

  it("undefined → 400 ApiError", () => {
    expect(() => parseIntInRange(undefined, "v", 1, 10)).toThrow(ApiError);
  });
});

// ─── parseBody ───────────────────────────────────────────────────────────────

describe("parseBody", () => {
  it("일반 객체 허용", () => {
    expect(parseBody({ a: 1 })).toEqual({ a: 1 });
    expect(parseBody({})).toEqual({});
  });

  it("배열 → 400 ApiError", () => {
    expect(() => parseBody([])).toThrow(ApiError);
  });

  it("null → 400 ApiError", () => {
    expect(() => parseBody(null)).toThrow(ApiError);
  });

  it("문자열 → 400 ApiError", () => {
    expect(() => parseBody("string")).toThrow(ApiError);
  });

  it("숫자 → 400 ApiError", () => {
    expect(() => parseBody(42)).toThrow(ApiError);
  });
});
