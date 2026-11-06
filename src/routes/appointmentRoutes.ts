import { Router } from "express";
import { Prisma, QueueStatus, type Appointment, type QueueEntry } from "@prisma/client";
import { prisma } from "../prisma";
import { ApiError } from "../errors/apiError";
import { parseBody, parseDate, parseId, parseStatus } from "../utils/parsers";

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
      const cancellableStatuses: QueueStatus[] = ["BOOKED", "CANCELLED"];
      if (!cancellableStatuses.includes(current.queueEntry.status)) {
        throw new ApiError(409, "An appointment with an active queue entry cannot be cancelled");
      }
      if (current.queueEntry.status === "BOOKED") {
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
      const cancellableStatuses: QueueStatus[] = ["BOOKED", "CANCELLED"];
      if (!cancellableStatuses.includes(current.queueEntry.status)) {
        throw new ApiError(409, "An appointment with an active queue entry cannot be cancelled");
      }
      if (current.queueEntry.status === "BOOKED") {
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

export default router;

