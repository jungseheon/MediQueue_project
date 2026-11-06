import { Router } from "express";
import { prisma } from "../prisma";
import { calculateEWMA, calculateQueueWaitTimes, type QueueItem } from "../services/calculator";
import { ApiError } from "../errors/apiError";
import { parseBody, parseId, parseQueueStatus } from "../utils/parsers";

const router = Router();

/**
 * 환자 목록의 초진(true) / 재진(false) 여부를 일괄 조회합니다.
 * 해당 의사에게 과거 'COMPLETED' 상태의 진료를 받은 이력이 있으면 재진(false), 없으면 초진(true)으로 판별합니다.
 */
async function getFirstVisitMap(patientIds: bigint[], doctorId: bigint): Promise<Map<string, boolean>> {
  const uniquePatientIds = Array.from(new Set(patientIds));
  if (uniquePatientIds.length === 0) return new Map();

  const completedAppointments = await prisma.appointment.findMany({
    where: {
      doctorId,
      patientId: { in: uniquePatientIds },
      queueEntry: {
        status: "COMPLETED",
      },
    },
    select: { patientId: true },
    distinct: ["patientId"],
  });

  const revisitSet = new Set(completedAppointments.map((a) => a.patientId.toString()));
  const map = new Map<string, boolean>();

  for (const pid of uniquePatientIds) {
    const pidStr = pid.toString();
    // 과거 완료된 진료 이력이 있으면 재진(false), 없으면 초진(true)
    map.set(pidStr, !revisitSet.has(pidStr));
  }

  return map;
}

// GET /api/doctors/:doctorId/queue
router.get("/doctors/:doctorId/queue", async (req, res) => {
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

  // 대기 환자들의 초진/재진 여부 판별
  const patientIds = queueEntries.map((entry) => entry.appointment.patientId);
  const firstVisitMap = await getFirstVisitMap(patientIds, doctorId);

  const estimates = calculateQueueWaitTimes(
    queueEntries.map((entry, index) => ({
      ticketId: index,
      appointmentTime: entry.appointment.scheduledAt,
      isFirstVisit: firstVisitMap.get(entry.appointment.patientId.toString()) ?? false,
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
      queue: queueEntries.map((entry, index) => {
        const isFirstVisit = firstVisitMap.get(entry.appointment.patientId.toString()) ?? false;
        return {
          id: entry.id.toString(),
          appointmentId: entry.appointmentId.toString(),
          patientId: entry.appointment.patientId.toString(),
          queuePosition: entry.queuePosition,
          status: entry.status.toLowerCase(),
          isFirstVisit,
          scheduledAt: entry.appointment.scheduledAt,
          estimatedStartTime: estimates[index].estimatedStartTime,
          estimatedWaitMinutes: Math.max(
            0,
            Math.ceil((estimates[index].estimatedStartTime.getTime() - now.getTime()) / 60_000),
          ),
          delayMinutes: estimates[index].delayMinutes,
        };
      }),
    },
  });
});

// PATCH /api/queue-entries/:id/status
router.patch("/queue-entries/:id/status", async (req, res) => {
  const queueEntryId = parseId(req.params.id, "id");
  const body = parseBody(req.body);
  const status = parseQueueStatus(body.status);

  const now = new Date();

  const targetEntry = await prisma.queueEntry.findUnique({
    where: { id: queueEntryId },
    include: { appointment: true },
  });

  if (!targetEntry) {
    throw new ApiError(404, "Queue entry not found");
  }

  const doctorId = targetEntry.appointment.doctorId;

  const updateData: {
    status: typeof status;
    startedAt?: Date;
    completedAt?: Date;
  } = { status };

  if (status === "IN_PROGRESS") {
    updateData.startedAt = now;
  } else if (status === "COMPLETED") {
    updateData.completedAt = now;
  }

  const updatedEntry = await prisma.queueEntry.update({
    where: { id: queueEntryId },
    data: updateData,
  });

  let newEWMA: number | null = null;
  let recalculatedQueue: ReturnType<typeof calculateQueueWaitTimes> = [];

  // 진료 완료 시 EWMA 재연산 및 대기열 재계산
  if (status === "COMPLETED") {
    const startTime = targetEntry.startedAt ?? targetEntry.checkedInAt ?? now;
    const actualDurationMinutes = Math.max(
      1,
      Math.round((now.getTime() - new Date(startTime).getTime()) / (1000 * 60)),
    );

    const stat = await prisma.serviceTimeStat.findUnique({
      where: {
        doctorId_serviceType: { doctorId, serviceType: "general" },
      },
    });

    const currentEWMA = stat ? Number(stat.ewmaMinutes) : 10.0;
    const alpha = 0.3;

    newEWMA = calculateEWMA(currentEWMA, actualDurationMinutes, alpha);

    await prisma.serviceTimeStat.upsert({
      where: { doctorId_serviceType: { doctorId, serviceType: "general" } },
      update: {
        ewmaMinutes: newEWMA,
        sampleCount: { increment: 1 },
      },
      create: {
        doctorId,
        serviceType: "general",
        ewmaMinutes: newEWMA,
        sampleCount: 1,
      },
    });

    // 남은 대기 중인 환자(CHECKED_IN, CALLED) 목록 조회
    const remainingWaitingEntries = await prisma.queueEntry.findMany({
      where: {
        status: { in: ["CHECKED_IN", "CALLED"] },
        appointment: { doctorId },
      },
      include: { appointment: true },
      orderBy: [{ queuePosition: "asc" }, { checkedInAt: "asc" }],
    });

    // 남은 대기자들의 초진/재진 여부 판별
    const patientIds = remainingWaitingEntries.map((e) => e.appointment.patientId);
    const firstVisitMap = await getFirstVisitMap(patientIds, doctorId);

    const waitingList: QueueItem[] = remainingWaitingEntries.map((entry) => ({
      ticketId: Number(entry.id),
      appointmentTime: entry.appointment.scheduledAt,
      isFirstVisit: firstVisitMap.get(entry.appointment.patientId.toString()) ?? false,
    }));

    recalculatedQueue = calculateQueueWaitTimes(waitingList, newEWMA, now);
  }

  res.json({
    data: {
      updatedEntry: {
        ...updatedEntry,
        id: updatedEntry.id.toString(),
        appointmentId: updatedEntry.appointmentId.toString(),
        status: updatedEntry.status.toLowerCase(),
      },
      updatedEWMA: newEWMA,
      recalculatedQueue,
    },
  });
});

export default router;
