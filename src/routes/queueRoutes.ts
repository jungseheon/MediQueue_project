import { Router } from "express";
import type { Prisma, QueueStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { calculateEWMA } from "../services/calculator";
import {
  ACTIVE_WAITING_STATUSES,
  DEFAULT_FIRST_VISIT_MINUTES,
  DEFAULT_FOLLOW_UP_MINUTES,
  estimateDoctorQueue,
  getFirstVisitMap,
  lockDoctorQueue,
} from "../services/queueEstimator";
import { ApiError } from "../errors/apiError";
import { parseBody, parseId, parseIntInRange, parseQueueStatus } from "../utils/parsers";
import { processNoShows } from "../services/noShowProcessor";
import { sseService } from "../services/sseService";

const router = Router();

// 상태 API로 바꿀 때 직전 상태가 반드시 이 중 하나여야 하는 상태들
// (진료 시작은 대기 중인 환자만, 진료 완료는 진료 중인 환자만 가능)
const REQUIRED_PREVIOUS_STATUSES: Partial<Record<QueueStatus, QueueStatus[]>> = {
  IN_PROGRESS: ["CHECKED_IN", "DISAPPEARED"],
  COMPLETED: ["IN_PROGRESS"],
};

// GET /api/doctors/:doctorId/queue
router.get("/doctors/:doctorId/queue", async (req, res) => {
  const doctorId = parseId(req.params.doctorId, "doctorId");
  await processNoShows();

  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new ApiError(404, "Doctor not found");

  const now = new Date();
  const queue = await estimateDoctorQueue(doctorId, now);

  res.json({
    data: {
      doctor: {
        id: doctor.id.toString(),
        displayName: doctor.displayName,
        department: doctor.department,
      },
      generatedAt: now,
      queue: queue.map(({ entry, isFirstVisit, estimate }) => ({
        id: entry.id.toString(),
        appointmentId: entry.appointmentId.toString(),
        patientId: entry.appointment.patientId.toString(),
        queuePosition: entry.queuePosition,
        status: entry.status.toLowerCase(),
        isFirstVisit,
        scheduledAt: entry.appointment.scheduledAt,
        estimatedStartTime: estimate.estimatedStartTime,
        estimatedWaitMinutes: Math.max(
          0,
          Math.ceil((estimate.estimatedStartTime.getTime() - now.getTime()) / 60_000),
        ),
        delayMinutes: estimate.delayMinutes,
      })),
    },
  });
});

// GET /api/doctors/:doctorId/stream (실시간 대기열 SSE 구독)
router.get("/doctors/:doctorId/stream", (req, res) => {
  const doctorId = parseId(req.params.doctorId, "doctorId").toString();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: "CONNECTED", doctorId })}\n\n`);
  sseService.addClient(doctorId, res);

  req.on("close", () => {
    sseService.removeClient(doctorId, res);
  });
});

// PATCH /api/queue-entries/:id/status
router.patch("/queue-entries/:id/status", async (req, res) => {
  const queueEntryId = parseId(req.params.id, "id");
  const body = parseBody(req.body);
  const status = parseQueueStatus(body.status);

  const now = new Date();

  const found = await prisma.queueEntry.findUnique({
    where: { id: queueEntryId },
    include: { appointment: true },
  });
  if (!found) throw new ApiError(404, "Queue entry not found");

  const doctorId = found.appointment.doctorId;

  const { updatedEntry, newEWMA } = await prisma.$transaction(async (tx) => {
    await lockDoctorQueue(tx, doctorId);

    // 잠금을 잡은 뒤 다시 읽어 동시에 들어온 요청과 겹치지 않게 한다
    const targetEntry = await tx.queueEntry.findUnique({
      where: { id: queueEntryId },
      include: { appointment: true },
    });
    if (!targetEntry) throw new ApiError(404, "Queue entry not found");

    const requiredPrevious = REQUIRED_PREVIOUS_STATUSES[status];
    if (requiredPrevious && !requiredPrevious.includes(targetEntry.status)) {
      throw new ApiError(
        409,
        `Cannot change status from '${targetEntry.status.toLowerCase()}' to '${status.toLowerCase()}'`,
      );
    }

    if (status === "IN_PROGRESS") {
      const otherInProgress = await tx.queueEntry.findFirst({
        where: { status: "IN_PROGRESS", appointment: { doctorId }, id: { not: queueEntryId } },
      });
      if (otherInProgress) {
        throw new ApiError(409, "Another patient is already in progress for this doctor");
      }
    }

    const updateData: Prisma.QueueEntryUpdateInput = { status };
    if (status === "IN_PROGRESS") {
      updateData.startedAt = now;
    } else if (status === "COMPLETED") {
      updateData.completedAt = now;
    }

    const updated = await tx.queueEntry.update({
      where: { id: queueEntryId },
      data: updateData,
    });

    // 진료 완료 시 실제 진료시간(진료 시작 ~ 완료)으로 초진/재진 EWMA 갱신
    let ewma: number | null = null;
    if (status === "COMPLETED" && targetEntry.startedAt) {
      const patientId = targetEntry.appointment.patientId;
      const isFirstVisit =
        (await getFirstVisitMap([patientId], doctorId, targetEntry.appointmentId, tx)).get(
          patientId.toString(),
        ) ?? false;
      const serviceType = isFirstVisit ? "FIRST_VISIT" : "FOLLOW_UP";

      const actualDurationMinutes = Math.max(
        1,
        Math.round((now.getTime() - targetEntry.startedAt.getTime()) / (1000 * 60)),
      );

      const stat = await tx.serviceTimeStat.findUnique({
        where: { doctorId_serviceType: { doctorId, serviceType } },
      });
      const currentEWMA = stat
        ? Number(stat.ewmaMinutes)
        : isFirstVisit
          ? DEFAULT_FIRST_VISIT_MINUTES
          : DEFAULT_FOLLOW_UP_MINUTES;

      const config = await tx.algorithmConfig.findUnique({
        where: { doctorId },
      });
      const alpha = config ? Number(config.alpha) : 0.3;

      ewma = calculateEWMA(currentEWMA, actualDurationMinutes, alpha);

      await tx.serviceTimeStat.upsert({
        where: { doctorId_serviceType: { doctorId, serviceType } },
        update: {
          ewmaMinutes: ewma,
          sampleCount: { increment: 1 },
        },
        create: {
          doctorId,
          serviceType,
          ewmaMinutes: ewma,
          sampleCount: 1,
        },
      });
    }

    return { updatedEntry: updated, newEWMA: ewma };
  });

  // 진료 완료 시 남은 대기자(CHECKED_IN, DISAPPEARED)의 예상 시간 재계산
  const recalculatedQueue =
    status === "COMPLETED"
      ? (await estimateDoctorQueue(doctorId, now)).map(({ estimate }) => estimate)
      : [];
  const configForAlert = await prisma.algorithmConfig.findUnique({ where: { doctorId }});
  const threshold = configForAlert?.delayThreshold ?? 10;

  const alertTargets = recalculatedQueue.filter(
    (estimate) => estimate.delayMinutes >= threshold
  );

  sseService.broadcastQueueUpdate(doctorId.toString(), {
    type: "QUEUE_UPDATED",
    updatedEWMA: newEWMA,
    recalculatedQueue,
    alertTargets,
  });

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

  if (!ACTIVE_WAITING_STATUSES.includes(entry.status)) {
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
  const body = req.body === undefined ? {} : parseBody(req.body);
  const delayPositions =
    body.delayPositions === undefined
      ? 2 // 기본 2칸 미룸
      : parseIntInRange(body.delayPositions, "delayPositions", 1, 10);

  const found = await prisma.queueEntry.findUnique({
    where: { id: queueEntryId },
    include: {
      appointment: {
        include: { patient: true },
      },
    },
  });

  if (!found) throw new ApiError(404, "Queue entry not found");

  const doctorId = found.appointment.doctorId;
  const patientName = found.appointment.patient.displayName;

  const result = await prisma.$transaction(async (tx) => {
    await lockDoctorQueue(tx, doctorId);

    const targetEntry = await tx.queueEntry.findUnique({ where: { id: queueEntryId } });
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

    const newDisappearCount = targetEntry.disappearCount + 1;

    // 부재 2회 초과 시 no_show로 전환
    if (newDisappearCount > 2) {
      const updated = await tx.queueEntry.update({
        where: { id: queueEntryId },
        data: { status: "NO_SHOW", disappearCount: newDisappearCount },
      });

      return {
        message: `${patientName} 환자가 부재 ${newDisappearCount}회로 'no_show' 처리되었습니다.`,
        updatedEntry: {
          id: updated.id.toString(),
          appointmentId: updated.appointmentId.toString(),
          queuePosition: updated.queuePosition,
          status: updated.status.toLowerCase(),
          disappearCount: updated.disappearCount,
        },
      };
    }

    // 현재 환자 바로 뒤에 대기 중인 환자들 (최대 delayPositions명, 순서대로)
    const subsequentEntries = await tx.queueEntry.findMany({
      where: {
        appointment: { doctorId },
        status: { in: ACTIVE_WAITING_STATUSES },
        queuePosition: { gt: targetEntry.queuePosition },
      },
      orderBy: { queuePosition: "asc" },
      take: delayPositions,
    });

    if (subsequentEntries.length === 0) {
      // 뒤에 대기 환자가 없으면 순번 유지, 상태만 DISAPPEARED로 변경
      const updated = await tx.queueEntry.update({
        where: { id: queueEntryId },
        data: { status: "DISAPPEARED", disappearCount: newDisappearCount },
      });

      return {
        message: `${patientName} 환자가 부재중으로 'disappeared'(자리비움) 처리되었습니다 (${newDisappearCount}/2회). 대기열의 마지막 순번이므로 순번(${targetEntry.queuePosition}번)은 유지됩니다.`,
        updatedEntry: {
          id: updated.id.toString(),
          appointmentId: updated.appointmentId.toString(),
          queuePosition: updated.queuePosition,
          status: updated.status.toLowerCase(),
          disappearCount: updated.disappearCount,
        },
      };
    }

    // 순번을 한 칸씩 돌린다: 뒤 환자들은 각각 바로 앞 사람의 순번을 받고,
    // 대상 환자는 마지막으로 앞지른 환자의 순번을 받는다. (순번이 연속되지 않아도 정확함)
    const positions = [
      targetEntry.queuePosition,
      ...subsequentEntries.map((entry) => entry.queuePosition),
    ];
    for (const [index, entry] of subsequentEntries.entries()) {
      await tx.queueEntry.update({
        where: { id: entry.id },
        data: { queuePosition: positions[index] },
      });
    }

    const actualShift = subsequentEntries.length;
    const targetNewPosition = positions[positions.length - 1];
    const updated = await tx.queueEntry.update({
      where: { id: queueEntryId },
      data: {
        queuePosition: targetNewPosition,
        status: "DISAPPEARED",
        disappearCount: newDisappearCount,
      },
    });

    return {
      message: `${patientName} 환자가 호출 시 부재중으로 'disappeared'(자리비움) 처리되었으며 (${newDisappearCount}/2회), 순번이 ${actualShift}칸 뒤로 연기되었습니다. (기존: ${targetEntry.queuePosition}번 -> 변경: ${targetNewPosition}번)`,
      updatedEntry: {
        id: updated.id.toString(),
        appointmentId: updated.appointmentId.toString(),
        queuePosition: updated.queuePosition,
        status: updated.status.toLowerCase(),
        disappearCount: updated.disappearCount,
      },
    };
  });

  // 대기 시간 실시간 재계산
  const recalculatedQueue = (await estimateDoctorQueue(doctorId)).map(({ estimate }) => estimate);

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
