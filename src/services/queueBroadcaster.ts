import { estimateDoctorQueue } from "./queueEstimator";
import { sseService } from "./sseService";

export async function broadcastDoctorQueue(
  doctorId: bigint,
  options: {
    updatedEWMA?: number | null;
    now?: Date;
  } = {},
) {
  const recalculatedQueue = (await estimateDoctorQueue(doctorId, options.now ?? new Date())).map(
    ({ estimate }) => estimate,
  );
  const alertTargets = recalculatedQueue.filter((estimate) => estimate.isAlertTriggered);

  sseService.broadcastQueueUpdate(doctorId.toString(), {
    type: "QUEUE_UPDATED",
    updatedEWMA: options.updatedEWMA ?? null,
    recalculatedQueue,
    alertTargets,
  });

  return recalculatedQueue;
}