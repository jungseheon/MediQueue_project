import { Prisma, type QueueStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { calculateQueueWaitTimes, type CalculatedResult } from "./calculator";

// 대기열에 포함되는 활성 대기 상태들
export const ACTIVE_WAITING_STATUSES: QueueStatus[] = ["CHECKED_IN", "DISAPPEARED"];

// 진료시간 통계가 없을 때 사용하는 기본값(분)
export const DEFAULT_FIRST_VISIT_MINUTES = 12;
export const DEFAULT_FOLLOW_UP_MINUTES = 8;
//추가 기본값
export const DEFAULT_PREP_MINUTES = 1;
export const DEFAULT_DELAY_THRESHOLD = 10;

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * 같은 의사의 대기열을 바꾸는 요청(체크인, 상태 변경, 부재 처리 등)을 트랜잭션 안에서 직렬화한다.
 * doctors 행에 FOR UPDATE 행 잠금을 걸어 같은 doctorId를 가진 트랜잭션이 동시에 진행되지 않도록 한다.
 * pg_advisory_xact_lock 대신 행 잠금을 쓰는 이유: Prisma의 $executeRaw에서 BigInt 타입 캐스팅이
 * 드라이버 버전에 따라 불안정할 수 있으므로, Prisma ORM이 타입을 보장하는 WHERE 절을 활용한다.
 */
export async function lockDoctorQueue(tx: Prisma.TransactionClient, doctorId: bigint) {
  await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${doctorId} FOR UPDATE`;
}

//수정: 통계가 없을 때 쓸 기본값을 파라미터로 받도록 변경
export async function getVisitDurations(
  doctorId: bigint, 
  db: Db = prisma, 
  defaultFirstVisit = DEFAULT_FIRST_VISIT_MINUTES, //추가 
  defaultFollowUp = DEFAULT_FOLLOW_UP_MINUTES, //추가
) {
  const serviceStats = await db.serviceTimeStat.findMany({
    where: { doctorId, serviceType: { in: ["FIRST_VISIT", "FOLLOW_UP"] } },
  });
  return {
    firstVisitTime: Number(
      serviceStats.find((stat) => stat.serviceType === "FIRST_VISIT")?.ewmaMinutes ??
        defaultFirstVisit, //수정
    ),
    revisitTime: Number(
      serviceStats.find((stat) => stat.serviceType === "FOLLOW_UP")?.ewmaMinutes ??
        defaultFollowUp, //수정
    ),
  };
}

/**
 * 환자 목록의 초진(true) / 재진(false) 여부를 일괄 조회합니다.
 * 해당 의사에게 과거 'COMPLETED' 상태의 진료를 받은 이력이 있으면 재진(false), 없으면 초진(true)으로 판별합니다.
 */
export async function getFirstVisitMap(
  patientIds: bigint[],
  doctorId: bigint,
  excludeAppointmentId?: bigint,
  db: Db = prisma,
): Promise<Map<string, boolean>> {
  const uniquePatientIds = Array.from(new Set(patientIds));
  if (uniquePatientIds.length === 0) return new Map();

  const completedAppointments = await db.appointment.findMany({
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

/**
 * 의사의 현재 대기열(checked_in, disappeared)과 각 환자의 예상 시작·지연 시간을 계산한다.
 * 진료 중(in_progress)인 환자가 있으면 그 환자의 초진/재진 예상 시간이 끝나는 시각부터 계산한다.
 */
export async function estimateDoctorQueue(doctorId: bigint, now = new Date()) {
  
  //DB에서 해당 의사의 알고리즘 설정 조회
  const config = await prisma.algorithmConfig.findUnique({
    where: { doctorId },
  });
  
  //DB 설정값 추출 (없으면 기본값 적용)
  const configFirstVisit = config?.firstVisitTime ?? DEFAULT_FIRST_VISIT_MINUTES;
  const configFollowUp = config?.reVisitTime ?? DEFAULT_FOLLOW_UP_MINUTES;
  const prepMinutes = config?.prepTime ?? DEFAULT_PREP_MINUTES;
  const delayThreshold = config?.delayThreshold ?? DEFAULT_DELAY_THRESHOLD;

  const [entries, inProgress, { firstVisitTime, revisitTime }] = await Promise.all([
    prisma.queueEntry.findMany({
      where: {
        status: { in: ACTIVE_WAITING_STATUSES },
        appointment: { doctorId },
      },
      include: { appointment: true },
      orderBy: [{ queuePosition: "asc" }, { checkedInAt: "asc" }],
    }),
    prisma.queueEntry.findFirst({
      where: { status: "IN_PROGRESS", appointment: { doctorId } },
      include: { appointment: true },
      orderBy: { startedAt: "desc" },
    }),

    //수정: 통계 없을 때 config의 초진/재진 기본시간을 쓰도록 전달
    getVisitDurations(doctorId, prisma, configFirstVisit, configFollowUp),
  ]);

  const patientIds = entries.map((entry) => entry.appointment.patientId);
  if (inProgress) patientIds.push(inProgress.appointment.patientId);
  const firstVisitMap = await getFirstVisitMap(patientIds, doctorId);
  const isFirstVisit = (patientId: bigint) => firstVisitMap.get(patientId.toString()) ?? false;

  let previousFinish = now;
  if (inProgress?.startedAt) {
    const expectedMinutes = isFirstVisit(inProgress.appointment.patientId)
      ? firstVisitTime
      : revisitTime;
    previousFinish = new Date(
      Math.max(now.getTime(), inProgress.startedAt.getTime() + expectedMinutes * 60_000),
    );
  }

  //동적 설정값(delayThreshold, prepMinutes)까지 계산기에 모두 전달
  const estimates: CalculatedResult[] = calculateQueueWaitTimes(
    entries.map((entry) => ({
      ticketId: Number(entry.id),
      appointmentTime: entry.appointment.scheduledAt,
      isFirstVisit: isFirstVisit(entry.appointment.patientId),
    })),
    (firstVisitTime + revisitTime) / 2,
    previousFinish,
    delayThreshold,
    firstVisitTime,
    revisitTime,
    prepMinutes,
  );

  return entries.map((entry, index) => ({
    entry,
    isFirstVisit: isFirstVisit(entry.appointment.patientId),
    estimate: estimates[index],
  }));
}
