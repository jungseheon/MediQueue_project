import { AppointmentStatus, QueueStatus } from "@prisma/client";
import { ApiError } from "../errors/apiError";

export function parseId(value: unknown, field: string): bigint {
  const text =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;

  if (typeof text !== "string" || !/^[1-9]\d*$/.test(text)) {
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
  "INPROGRESS",
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

export function parseBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}
