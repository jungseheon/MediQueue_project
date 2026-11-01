import "dotenv/config";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import {
  AppointmentStatus,
  Prisma,
  QueueStatus,
  type Appointment,
  type QueueEntry,
} from "@prisma/client";
import { prisma } from "./prisma";
import { calculateQueueWaitTimes } from "./services/calculator";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok", database: "ok" });
  } catch {
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.get("/api/doctors/:doctorId/queue", async (req, res) => {
  const doctorId = parseId(req.params.doctorId, "doctorId");
  const [doctor, queueEntries, inProgress] = await Promise.all([
    prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { serviceTimeStats: { where: { serviceType: "general" } } },
    }),
    prisma.queueEntry.findMany({
      where: {
        status: { in: ["CHECKED_IN", "CALLED"] },
        appointment: { doctorId },
      },
      include: { appointment: true },
      orderBy: [{ queuePosition: "asc" }, { checkedInAt: "asc" }],
    }),
    prisma.queueEntry.findFirst({
      where: { status: "IN_PROGRESS", appointment: { doctorId } },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  if (!doctor) throw new ApiError(404, "Doctor not found");

  const now = new Date();
  const ewmaMinutes = Number(doctor.serviceTimeStats[0]?.ewmaMinutes ?? 10);
  const previousFinish = inProgress?.startedAt
    ? new Date(Math.max(now.getTime(), inProgress.startedAt.getTime() + ewmaMinutes * 60_000))
    : now;
  const estimates = calculateQueueWaitTimes(
    queueEntries.map((entry, index) => ({
      ticketId: index,
      appointmentTime: entry.appointment.scheduledAt,
      isFirstVisit: false,
    })),
    ewmaMinutes,
    previousFinish,
  );

  res.json({
    data: {
      doctor: {
        id: doctor.id.toString(),
        displayName: doctor.displayName,
        department: doctor.department,
      },
      generatedAt: now,
      queue: queueEntries.map((entry, index) => ({
        id: entry.id.toString(),
        appointmentId: entry.appointmentId.toString(),
        queuePosition: entry.queuePosition,
        status: entry.status.toLowerCase(),
        scheduledAt: entry.appointment.scheduledAt,
        estimatedStartTime: estimates[index].estimatedStartTime,
        estimatedWaitMinutes: Math.max(
          0,
          Math.ceil((estimates[index].estimatedStartTime.getTime() - now.getTime()) / 60_000),
        ),
        delayMinutes: estimates[index].delayMinutes,
      })),
    },
  });
});

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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

function parseId(value: unknown, field: string): bigint {
  const text = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : value;

  if (typeof text !== "string" || !/^[1-9]\d*$/.test(text)) {
    throw new ApiError(400, `${field} must be a positive integer`);
  }

  return BigInt(text);
}

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, `${field} must be a valid date string`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `${field} must be a valid date string`);
  }

  return date;
}

function parseStatus(value: unknown): AppointmentStatus {
  if (value === "booked" || value === "BOOKED") return "BOOKED";
  if (value === "cancelled" || value === "CANCELLED") return "CANCELLED";
  throw new ApiError(400, "status must be 'booked' or 'cancelled'");
}

function parseBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

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

app.get("/api/appointments", async (req, res) => {
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

app.get("/api/appointments/:id", async (req, res) => {
  const id = parseId(req.params.id, "id");
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: appointmentInclude,
  });

  if (!appointment) throw new ApiError(404, "Appointment not found");
  res.json({ data: serializeAppointment(appointment) });
});

app.post("/api/appointments", async (req, res) => {
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

app.patch("/api/appointments/:id", async (req, res) => {
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

app.delete("/api/appointments/:id", async (req, res) => {
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

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") {
      res.status(400).json({ error: "doctorId or patientId does not exist" });
      return;
    }
    if (error.code === "P2025") {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }
  }

  console.error(error);
  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`MediQueue API listening on port ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
