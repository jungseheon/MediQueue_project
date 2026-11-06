import { Router } from "express";
import { prisma } from "../prisma";
import { calculateEWMA, calculateQueueWaitTimes, type QueueItem } from "../services/calculator";
import { ApiError } from "../errors/apiError";
import { parseBody, parseId, parseQueueStatus } from "../utils/parsers";
import { processNoShows } from "../services/noShowProcessor";

const router = Router();

// 대기열에 포함되는 활성 대기 상태들
const ACTIVE_WAITING_STATUSES = ["CHECKED_IN", "DISAPPEARED"] as const;

async function getVisitDurations(doctorId: bigint) {
  const serviceStats = await prisma.serviceTimeStat.findMany({
    where: { doctorId, serviceType: { in: ["FIRST_VISIT", "FOLLOW_UP"] } },
  });
  return {
    firstVisitTime: Number(
      serviceStats.find((stat) => stat.serviceType === "FIRST_VISIT")?.ewmaMinutes ?? 12,
    ),
    revisitTime: Number(
      serviceStats.find((stat) => stat.serviceType === "FOLLOW_UP")?.ewmaMinutes ?? 8,
    ),
  };
}

/**
 * 환자 목록의 초진(true) / 재진(false) 여부를 일괄 조회합니다.
 * 해당 의사에게 과거 'COMPLETED' 상태의 진료를 받은 이력이 있으면 재진(false), 없으면 초진(true)으로 판별합니다.
 */
async function getFirstVisitMap(
  patientIds: bigint[],
  doctorId: bigint,
  excludeAppointmentId?: bigint,
): Promise<Map<string, boolean>> {
  const uniquePatientIds = Array.from(new Set(patientIds));
  if (uniquePatientIds.length === 0) return new Map();

  const completedAppointments = await prisma.appointment.findMany({
    where: {
      doctorId,
      patientId: { in: uniquePatientIds },
      id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
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
    map.set(pidStr, !revisitSet.has(pidStr));
  }

  return map;
}

// GET /api/doctors/:doctorId/queue
router.get("/doctors/:doctorId/queue", async (req, res) => {
  await processNoShows();
  const doctorId = parseId(req.params.doctorId, "doctorId");
  const [doctor, queueEntries, inProgress, visitDurations] = await Promise.all([
    prisma.doctor.findUnique({
      where: { id: doctorId },
    }),
    prisma.queueEntry.findMany({
      where: {
        status: { in: [...ACTIVE_WAITING_STATUSES] },
        appointment: { doctorId },
      },
      include: { appointment: true },
      orderBy: [{ queuePosition: "asc" }, { checkedInAt: "asc" }],
    }),
    prisma.queueEntry.findFirst({
      where: { status: "INPROGRESS", appointment: { doctorId } },
      orderBy: { startedAt: "desc" },
    }),
    getVisitDurations(doctorId),
  ]);

  if (!doctor) throw new ApiError(404, "Doctor not found");

  const now = new Date();
  const { firstVisitTime, revisitTime } = visitDurations;
  const ewmaMinutes = (firstVisitTime + revisitTime) / 2;
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
    10,
    firstVisitTime,
    revisitTime,
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

  const firstVisitAtCompletion =
    status === "COMPLETED"
      ? (
          await getFirstVisitMap(
            [targetEntry.appointment.patientId],
            doctorId,
            targetEntry.appointmentId,
          )
        ).get(targetEntry.appointment.patientId.toString()) ?? false
      : false;

  if (status === "INPROGRESS") {
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

    const serviceType = firstVisitAtCompletion ? "FIRST_VISIT" : "FOLLOW_UP";
    const stat = await prisma.serviceTimeStat.findUnique({
      where: {
        doctorId_serviceType: { doctorId, serviceType },
      },
    });

    const currentEWMA = stat
      ? Number(stat.ewmaMinutes)
      : serviceType === "FIRST_VISIT"
        ? 12
        : 8;
    const alpha = 0.3;

    newEWMA = calculateEWMA(currentEWMA, actualDurationMinutes, alpha);

    await prisma.serviceTimeStat.upsert({
      where: { doctorId_serviceType: { doctorId, serviceType } },
      update: {
        ewmaMinutes: newEWMA,
        sampleCount: { increment: 1 },
      },
      create: {
        doctorId,
        serviceType,
        ewmaMinutes: newEWMA,
        sampleCount: 1,
      },
    });

    // 남은 대기 중인 환자(CHECKED_IN, DISAPPEARED) 목록 조회
    const remainingWaitingEntries = await prisma.queueEntry.findMany({
      where: {
        status: { in: [...ACTIVE_WAITING_STATUSES] },
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

    const visitDurations = await getVisitDurations(doctorId);
    recalculatedQueue = calculateQueueWaitTimes(
      waitingList,
      (visitDurations.firstVisitTime + visitDurations.revisitTime) / 2,
      now,
      10,
      visitDurations.firstVisitTime,
      visitDurations.revisitTime,
    );
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

// POST /api/queue-entries/:id/call (환자 진료실 호출)
router.post("/queue-entries/:id/call", async (req, res) => {
  const queueEntryId = parseId(req.params.id, "id");

  const entry = await prisma.queueEntry.findUnique({
    where: { id: queueEntryId },
    include: {
      appointment: {
        include: {
          doctor: true,
          patient: true,
        },
      },
    },
  });

  if (!entry) throw new ApiError(404, "Queue entry not found");

  const callableStatuses = ["CHECKED_IN", "DISAPPEARED"];
  if (!callableStatuses.includes(entry.status)) {
    throw new ApiError(
      409,
      `Cannot call patient with status '${entry.status.toLowerCase()}'. Patient must be in checked_in or disappeared status.`,
    );
  }

  const updatedEntry = await prisma.queueEntry.update({
    where: { id: queueEntryId },
    data: { calledAt: new Date() },
    include: {
      appointment: {
        include: { doctor: true, patient: true },
      },
    },
  });

  const patientName = updatedEntry.appointment.patient.displayName;
  const department = updatedEntry.appointment.doctor.department;
  const doctorName = updatedEntry.appointment.doctor.displayName;
  const callMessage = `${patientName}님, ${department} (${doctorName} 의사실)로 들어오세요.`;

  res.json({
    data: {
      queueEntry: {
        id: updatedEntry.id.toString(),
        appointmentId: updatedEntry.appointmentId.toString(),
        queuePosition: updatedEntry.queuePosition,
        status: updatedEntry.status.toLowerCase(),
      },
      callMessage,
    },
  });
});

// POST /api/queue-entries/:id/disappear (호출 후 부재중 -> 'disappeared' 상태 변경 및 순번 1~2칸 뒤로 연기)
router.post("/queue-entries/:id/disappear", async (req, res) => {
  const queueEntryId = parseId(req.params.id, "id");
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const delayPositions = Math.max(1, Math.min(10, Number(body.delayPositions ?? 2))); // 기본 2칸 미룸

  const targetEntry = await prisma.queueEntry.findUnique({
    where: { id: queueEntryId },
    include: {
      appointment: {
        include: { doctor: true, patient: true },
      },
    },
  });

  if (!targetEntry) throw new ApiError(404, "Queue entry not found");

  if (
    (targetEntry.status !== "CHECKED_IN" && targetEntry.status !== "DISAPPEARED") ||
    !targetEntry.calledAt
  ) {
    throw new ApiError(
      409,
      `Cannot mark as disappeared for entry with status '${targetEntry.status.toLowerCase()}'. The patient must have been called.`,
    );
  }

  const doctorId = targetEntry.appointment.doctorId;
  const patientName = targetEntry.appointment.patient.displayName;

  const result = await prisma.$transaction(async (tx) => {
    // 현재 환자 뒤에 대기 중인 환자들 조회 (순서대로)
    const subsequentEntries = await tx.queueEntry.findMany({
      where: {
        appointment: { doctorId },
        status: { in: [...ACTIVE_WAITING_STATUSES] },
        queuePosition: { gt: targetEntry.queuePosition },
      },
      orderBy: { queuePosition: "asc" },
    });

    if (subsequentEntries.length === 0) {
      // 뒤에 대기 환자가 없으면 순번 유지, 상태만 DISAPPEARED로 변경
      const updated = await tx.queueEntry.update({
        where: { id: queueEntryId },
        data: { status: "DISAPPEARED" },
      });

      return {
        message: `${patientName} 환자가 부재중으로 'disappeared'(자리비움) 처리되었습니다. 대기열의 마지막 순번이므로 순번(${targetEntry.queuePosition}번)은 유지됩니다.`,
        updatedEntry: {
          id: updated.id.toString(),
          appointmentId: updated.appointmentId.toString(),
          queuePosition: updated.queuePosition,
          status: updated.status.toLowerCase(),
        },
      };
    }

    const actualShift = Math.min(delayPositions, subsequentEntries.length);
    const targetNewPosition = targetEntry.queuePosition + actualShift;
    const shiftedEntryIds = subsequentEntries.slice(0, actualShift).map((e) => e.id);

    // 대상 환자 임시 번호로 변경
    await tx.queueEntry.update({
      where: { id: queueEntryId },
      data: { queuePosition: -1 },
    });

    // 뒤에 있던 환자들을 앞으로 당김
    await tx.queueEntry.updateMany({
      where: { id: { in: shiftedEntryIds } },
      data: { queuePosition: { decrement: 1 } },
    });

    // 대상 환자의 새 순번 부여 및 상태를 DISAPPEARED로 설정
    const updated = await tx.queueEntry.update({
      where: { id: queueEntryId },
      data: {
        queuePosition: targetNewPosition,
        status: "DISAPPEARED",
      },
    });

    return {
      message: `${patientName} 환자가 호출 시 부재중으로 'disappeared'(자리비움) 처리되었으며, 순번이 ${actualShift}칸 뒤로 연기되었습니다. (기존: ${targetEntry.queuePosition}번 -> 변경: ${targetNewPosition}번)`,
      updatedEntry: {
        id: updated.id.toString(),
        appointmentId: updated.appointmentId.toString(),
        queuePosition: updated.queuePosition,
        status: updated.status.toLowerCase(),
      },
    };
  });

  // 대기 시간 실시간 재계산
  const now = new Date();
  const [doctor, remainingWaitingEntries, inProgress] = await Promise.all([
    prisma.doctor.findUnique({
      where: { id: doctorId },
      include: {
        serviceTimeStats: { where: { serviceType: { in: ["FIRST_VISIT", "FOLLOW_UP"] } } },
      },
    }),
    prisma.queueEntry.findMany({
      where: {
        status: { in: [...ACTIVE_WAITING_STATUSES] },
        appointment: { doctorId },
      },
      include: { appointment: true },
      orderBy: [{ queuePosition: "asc" }, { checkedInAt: "asc" }],
    }),
    prisma.queueEntry.findFirst({
      where: { status: "INPROGRESS", appointment: { doctorId } },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const firstVisitTime = Number(
    doctor?.serviceTimeStats.find((stat) => stat.serviceType === "FIRST_VISIT")?.ewmaMinutes ?? 12,
  );
  const revisitTime = Number(
    doctor?.serviceTimeStats.find((stat) => stat.serviceType === "FOLLOW_UP")?.ewmaMinutes ?? 8,
  );
  const ewmaMinutes = (firstVisitTime + revisitTime) / 2;
  const previousFinish = inProgress?.startedAt
    ? new Date(Math.max(now.getTime(), inProgress.startedAt.getTime() + ewmaMinutes * 60_000))
    : now;

  const patientIds = remainingWaitingEntries.map((e) => e.appointment.patientId);
  const firstVisitMap = await getFirstVisitMap(patientIds, doctorId);

  const recalculatedQueue = calculateQueueWaitTimes(
    remainingWaitingEntries.map((entry) => ({
      ticketId: Number(entry.id),
      appointmentTime: entry.appointment.scheduledAt,
      isFirstVisit: firstVisitMap.get(entry.appointment.patientId.toString()) ?? false,
    })),
    ewmaMinutes,
    previousFinish,
    10,
    firstVisitTime,
    revisitTime,
  );

  res.json({
    data: {
      ...result,
      recalculatedQueue,
    },
  });
});

// POST /api/queue-entries/:id/return (자리비움 'disappeared' 환자가 대기실로 돌아왔을 때 'checked_in' 복귀)
router.post("/queue-entries/:id/return", async (req, res) => {
  const queueEntryId = parseId(req.params.id, "id");

  const targetEntry = await prisma.queueEntry.findUnique({
    where: { id: queueEntryId },
    include: {
      appointment: {
        include: { patient: true },
      },
    },
  });

  if (!targetEntry) throw new ApiError(404, "Queue entry not found");

  if (targetEntry.status !== "DISAPPEARED") {
    throw new ApiError(
      409,
      `Patient status is '${targetEntry.status.toLowerCase()}'. Return can only be processed for 'disappeared' status.`,
    );
  }

  const updated = await prisma.queueEntry.update({
    where: { id: queueEntryId },
    data: { status: "CHECKED_IN", calledAt: null },
  });

  res.json({
    data: {
      message: `${targetEntry.appointment.patient.displayName} 환자가 복귀하여 대기 상태(checked_in)로 전환되었습니다. (현재 순번: ${updated.queuePosition}번)`,
      updatedEntry: {
        id: updated.id.toString(),
        appointmentId: updated.appointmentId.toString(),
        queuePosition: updated.queuePosition,
        status: updated.status.toLowerCase(),
      },
    },
  });
});

export default router;
