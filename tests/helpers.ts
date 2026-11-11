import type { QueueStatus } from "@prisma/client";
import { prisma } from "../src/prisma";

// 테스트마다 테이블을 비워 격리 보장
export async function truncateAll() {
  await prisma.$executeRaw`TRUNCATE doctors, patients CASCADE`;
}

export async function createDoctor(displayName = "테스트의사", department = "내과") {
  return prisma.doctor.create({ data: { displayName, department } });
}

export async function createPatient(displayName: string) {
  return prisma.patient.create({ data: { displayName } });
}

export async function createAppointment(doctorId: bigint, patientId: bigint, scheduledAt?: Date) {
  return prisma.appointment.create({
    data: {
      doctorId,
      patientId,
      scheduledAt: scheduledAt ?? new Date(Date.now() - 60_000),
      status: "BOOKED",
    },
  });
}

export async function createQueueEntry(
  appointmentId: bigint,
  queuePosition: number,
  status: QueueStatus,
  options: { calledAt?: Date; checkedInAt?: Date; disappearCount?: number } = {},
) {
  const checkedInAt =
    options.checkedInAt ??
    (status !== "BOOKED" && status !== "NO_SHOW" ? new Date() : null);

  return prisma.queueEntry.create({
    data: {
      appointmentId,
      queuePosition,
      status,
      checkedInAt,
      calledAt: options.calledAt ?? null,
      disappearCount: options.disappearCount ?? 0,
    },
  });
}
