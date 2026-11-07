import { AppointmentStatus, QueueStatus } from "@prisma/client";
import { ApiError } from "../errors/apiError";

const MAX_BIGINT = 9223372036854775807n;

export function parseId(value: unknown, field: string): bigint {
  const text =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;

  // PostgreSQL BIGINT 최댓값을 넘는 ID는 DB 오류(500) 대신 400으로 처리
  if (typeof text !== "string" || !/^[1-9]\d*$/.test(text) || BigInt(text) > MAX_BIGINT) {
    throw new ApiError(400, `${field} must be a positive integer`);
  }

  return BigInt(text);
}

export function parseDate(value: unknown, field: string): Date {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, `${field} must be a valid date string`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `${field} must be a valid date string`);
  }

  return date;
}

export function parseStatus(value: unknown): AppointmentStatus {
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (upper === "BOOKED" || upper === "CANCELLED") {
      return upper as AppointmentStatus;
    }
  }
  throw new ApiError(400, "status must be 'booked' or 'cancelled'");
}

const VALID_QUEUE_STATUSES: QueueStatus[] = [
  "BOOKED",
  "CHECKED_IN",
  "CANCELLED",
  "DISAPPEARED",
  "IN_PROGRESS",
  "COMPLETED",
  "NO_SHOW",
];

export function parseQueueStatus(value: unknown): QueueStatus {
  if (typeof value === "string") {
    const upper = value.toUpperCase() as QueueStatus;
    if (VALID_QUEUE_STATUSES.includes(upper)) {
      return upper;
    }
  }
  throw new ApiError(
    400,
    `status must be one of: ${VALID_QUEUE_STATUSES.map((s) => s.toLowerCase()).join(", ")}`,
  );
}

// 정수 문자열 또는 안전한 정수를 받아 [min, max] 범위의 정수로 검증
export function parseIntInRange(value: unknown, field: string, min: number, max: number): number {
  const number = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max) {
    throw new ApiError(400, `${field} must be an integer between ${min} and ${max}`);
  }
  return number;
}

export function parseBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}
