import { Router } from "express";
import { Prisma, QueueStatus, type Appointment, type QueueEntry } from "@prisma/client";
import { prisma } from "../prisma";
import { ApiError } from "../errors/apiError";
import { parseBody, parseDate, parseId, parseStatus } from "../utils/parsers";
import { processNoShows } from "../services/noShowProcessor";

const router = Router();

type AppointmentRecord = Appointment & {
  doctor: { id: bigint; displayName: string; department: string };
  patient: { id: bigint; displayName: string };
  queueEntry: QueueEntry | null;
};

const appointmentInclude = {
  doctor: true,
  patient: true,
  queueEntry: true,
} satisfies Prisma.AppointmentInclude;

function serializeAppointment(appointment: AppointmentRecord) {
  return {
    ...appointment,
    id: appointment.id.toString(),
    doctorId: appointment.doctorId.toString(),
    patientId: appointment.patientId.toString(),
    status: appointment.status.toLowerCase(),
    doctor: { ...appointment.doctor, id: appointment.doctor.id.toString() },
    patient: { ...appointment.patient, id: appointment.patient.id.toString() },
    queueEntry: appointment.queueEntry
      ? {
          ...appointment.queueEntry,
          id: appointment.queueEntry.id.toString(),
          appointmentId: appointment.queueEntry.appointmentId.toString(),
          status: appointment.queueEntry.status.toLowerCase(),
        }
      : null,
  };
}

// GET /api/appointments
router.get("/", async (req, res) => {
  await processNoShows();

  const where: Prisma.AppointmentWhereInput = {};
  if (req.query.doctorId !== undefined) {
    where.doctorId = parseId(req.query.doctorId, "doctorId");
  }
  if (req.query.patientId !== undefined) {
    where.patientId = parseId(req.query.patientId, "patientId");
  }
  if (req.query.status !== undefined) {
    where.status = parseStatus(req.query.status);
  }

  const appointments = await prisma.appointment.findMany({
    where,
    include: appointmentInclude,
    orderBy: { scheduledAt: "asc" },
  });

  res.json({ data: appointments.map(serializeAppointment) });
});

// GET /api/appointments/:id
router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id, "id");
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: appointmentInclude,
  });

  if (!appointment) throw new ApiError(404, "Appointment not found");
  res.json({ data: serializeAppointment(appointment) });
});

// POST /api/appointments
router.post("/", async (req, res) => {
  const body = parseBody(req.body);
  const appointment = await prisma.appointment.create({
    data: {
      doctorId: parseId(body.doctorId, "doctorId"),
      patientId: parseId(body.patientId, "patientId"),
      scheduledAt: parseDate(body.scheduledAt, "scheduledAt"),
    },
    include: appointmentInclude,
  });

  res.status(201).json({ data: serializeAppointment(appointment) });
});

// PATCH /api/appointments/:id
router.patch("/:id", async (req, res) => {
  const id = parseId(req.params.id, "id");
  const body = parseBody(req.body);
  const data: Prisma.AppointmentUncheckedUpdateInput = {};

  if (Object.hasOwn(body, "doctorId")) {
    data.doctorId = parseId(body.doctorId, "doctorId");
  }
  if (Object.hasOwn(body, "patientId")) {
    data.patientId = parseId(body.patientId, "patientId");
  }
  if (Object.hasOwn(body, "scheduledAt")) {
    data.scheduledAt = parseDate(body.scheduledAt, "scheduledAt");
  }
  if (Object.hasOwn(body, "status")) {
    data.status = parseStatus(body.status);
  }
  if (Object.keys(data).length === 0) {
    throw new ApiError(400, "At least one appointment field is required");
  }

  const appointment = await prisma.$transaction(async (transaction) => {
    const current = await transaction.appointment.findUnique({
      where: { id },
      include: { queueEntry: true },
    });
    if (!current) throw new ApiError(404, "Appointment not found");

    if (data.status === "BOOKED" && current.status === "CANCELLED") {
      throw new ApiError(409, "A cancelled appointment cannot be reactivated");
    }
    if (data.status === "CANCELLED" && current.queueEntry) {
      const cancellableStatuses: QueueStatus[] = ["BOOKED", "CANCELLED", "NO_SHOW"];
      if (!cancellableStatuses.includes(current.queueEntry.status)) {
        throw new ApiError(409, "An appointment with an active queue entry cannot be cancelled");
      }
      if (current.queueEntry.status !== "CANCELLED") {
        await transaction.queueEntry.update({
          where: { appointmentId: id },
          data: { status: "CANCELLED" },
        });
      }
    }

    return transaction.appointment.update({
      where: { id },
      data,
      include: appointmentInclude,
    });
  });

  res.json({ data: serializeAppointment(appointment) });
});

// DELETE /api/appointments/:id
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id, "id");
  const appointment = await prisma.$transaction(async (transaction) => {
    const current = await transaction.appointment.findUnique({
      where: { id },
      include: { queueEntry: true },
    });
    if (!current) throw new ApiError(404, "Appointment not found");

    if (current.queueEntry) {
      const cancellableStatuses: QueueStatus[] = ["BOOKED", "CANCELLED", "NO_SHOW"];
      if (!cancellableStatuses.includes(current.queueEntry.status)) {
        throw new ApiError(409, "An appointment with an active queue entry cannot be cancelled");
      }
      if (current.queueEntry.status !== "CANCELLED") {
        await transaction.queueEntry.update({
          where: { appointmentId: id },
          data: { status: "CANCELLED" },
        });
      }
    }

    return transaction.appointment.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: appointmentInclude,
    });
  });

  res.json({ data: serializeAppointment(appointment) });
});

// POST /api/appointments/:id/check-in
router.post("/:id/check-in", async (req, res) => {
  const id = parseId(req.params.id, "id");
  const now = new Date();
  await processNoShows(now);

  const result = await prisma.$transaction(async (tx) => {
    // 1. 예약 정보 확인
    const appointment = await tx.appointment.findUnique({
      where: { id },
      include: {
        doctor: true,
        patient: true,
        queueEntry: true,
      },
    });

    if (!appointment) {
      throw new ApiError(404, "Appointment not found");
    }

    if (appointment.status === "CANCELLED") {
      throw new ApiError(409, "Cannot check in a cancelled appointment");
    }

    // 이미 체크인 진행 중이거나 완료된 경우 중복 체크인 방지
    if (appointment.queueEntry) {
      const activeStatuses: QueueStatus[] = ["CHECKED_IN", "INPROGRESS", "COMPLETED", "DISAPPEARED"];
      if (activeStatuses.includes(appointment.queueEntry.status)) {
        throw new ApiError(409, "Appointment is already checked in");
      }
      if (appointment.queueEntry.status === "CANCELLED" || appointment.queueEntry.status === "NO_SHOW") {
        throw new ApiError(
          409,
          `Cannot check in an appointment with status '${appointment.queueEntry.status.toLowerCase()}'`,
        );
      }
    }

    // 2. 당일 해당 의사의 최대 queuePosition 조회 후 +1 순번 부여 (1부터 시작)
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const maxEntry = await tx.queueEntry.findFirst({
      where: {
        appointment: { doctorId: appointment.doctorId },
        checkedInAt: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
      orderBy: { queuePosition: "desc" },
    });

    const nextPosition = (maxEntry?.queuePosition ?? 0) + 1;

    // 3. QueueEntry 생성 또는 업데이트 (BOOKED 상태 엔트리가 있으면 갱신, 없으면 생성)
    let queueEntry: QueueEntry;
    if (appointment.queueEntry) {
      queueEntry = await tx.queueEntry.update({
        where: { appointmentId: id },
        data: {
          queuePosition: nextPosition,
          status: "CHECKED_IN",
          checkedInAt: now,
          calledAt: null,
        },
      });
    } else {
      queueEntry = await tx.queueEntry.create({
        data: {
          appointmentId: id,
          queuePosition: nextPosition,
          status: "CHECKED_IN",
          checkedInAt: now,
        },
      });
    }

    return {
      queueEntry: {
        id: queueEntry.id.toString(),
        appointmentId: queueEntry.appointmentId.toString(),
        queuePosition: queueEntry.queuePosition,
        status: queueEntry.status.toLowerCase(),
        checkedInAt: queueEntry.checkedInAt,
      },
      appointment: {
        id: appointment.id.toString(),
        doctorId: appointment.doctorId.toString(),
        patientId: appointment.patientId.toString(),
        scheduledAt: appointment.scheduledAt,
        status: appointment.status.toLowerCase(),
        doctor: {
          id: appointment.doctor.id.toString(),
          displayName: appointment.doctor.displayName,
          department: appointment.doctor.department,
        },
        patient: {
          id: appointment.patient.id.toString(),
          displayName: appointment.patient.displayName,
        },
      },
    };
  });

  res.status(200).json({ data: result });
});

export default router;
