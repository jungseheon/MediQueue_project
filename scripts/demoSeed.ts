/**
 * 시연용 "오늘" 데이터 생성 (npm run db:demo)
 *
 * dump.sql은 10월 데이터라 오늘 대기열이 비어 있다. 이 스크립트는 dump.sql을 복원한 DB에
 * 오늘(KST) 기준으로 진료 완료·진료 중·대기·예약 환자를 만들어 병원용·환자용 화면을 바로 시연할 수 있게 한다.
 *
 * - 대상: 13번 의사(온유 정신건강의학과, 환자용 화면의 첫 병원)
 * - 환자용 화면의 시연 환자(4번 양윤서)는 대기 2번째로 들어가고, 내일 23번 의사 예약도 하나 생긴다.
 * - 기존 데이터는 지우지 않는다. 13번 의사에게 오늘 예약이 이미 있으면 중복 생성을 막기 위해 아무것도 하지 않는다.
 */
import { prisma } from "../src/prisma";
import { calculateEWMA } from "../src/services/calculator";
import { DEFAULT_ALGORITHM_CONFIG } from "../src/services/queueEstimator";
import { getKstDayRange } from "../src/utils/time";

const DOCTOR_ID = 13n; // 온유 정신건강의학과
const OTHER_DOCTOR_ID = 23n; // 마음봄 정신건강의학과
const DEMO_PATIENT_ID = 4n; // 환자용 화면의 고정 환자 (양윤서)
const MINUTE = 60_000;

// 오늘 진료를 마친 환자: 예약 시각(분 전), 실제 진료시간(분). dump.sql에서 13번 의사 진료 이력이 없는 환자들이다.
const COMPLETED = [
  { patientId: 11n, scheduledAgo: 95, durationMinutes: 14 },
  { patientId: 12n, scheduledAgo: 75, durationMinutes: 11 },
  { patientId: 14n, scheduledAgo: 55, durationMinutes: 17 },
];
const IN_PROGRESS = { patientId: 15n, scheduledAgo: 35, startedAgo: 8 };
// 체크인한 대기 환자 (순서대로 순번 발급)
const WAITING = [
  { patientId: 16n, scheduledAgo: 25 },
  { patientId: DEMO_PATIENT_ID, scheduledAgo: 15 },
  { patientId: 17n, scheduledAgo: 5 },
];
// 아직 도착하지 않은 오늘 예약 (체크인 시연용)
const BOOKED_LATER = [
  { patientId: 19n, scheduledIn: 30 },
  { patientId: 20n, scheduledIn: 60 },
];

async function main() {
  const now = new Date();
  const { start: todayStart, end: todayEnd } = getKstDayRange(now);

  // 가장 이른 예약(95분 전 + 진료 기록)이 어제로 넘어가지 않도록 새벽에는 실행하지 않는다
  const earliest = now.getTime() - 120 * MINUTE;
  if (earliest < todayStart.getTime()) {
    throw new Error("한국 시간 새벽 2시 이전에는 오늘 데이터가 어제로 넘어가므로 실행하지 않습니다.");
  }

  const doctors = await prisma.doctor.findMany({ where: { id: { in: [DOCTOR_ID, OTHER_DOCTOR_ID] } } });
  const patientIds = [...COMPLETED, IN_PROGRESS, ...WAITING, ...BOOKED_LATER].map((item) => item.patientId);
  const patients = await prisma.patient.count({ where: { id: { in: patientIds } } });
  if (doctors.length !== 2 || patients !== new Set(patientIds).size) {
    throw new Error("dump.sql 샘플 데이터(의사 13·23번, 환자 4·11~20번)가 없습니다. README의 실행 방법대로 먼저 복원하세요.");
  }

  const existing = await prisma.appointment.count({
    where: { doctorId: DOCTOR_ID, scheduledAt: { gte: todayStart, lt: todayEnd } },
  });
  if (existing > 0) {
    console.log(`13번 의사에게 오늘 예약이 이미 ${existing}건 있어 새로 만들지 않았습니다.`);
    return;
  }

  const at = (minutesFromNow: number) => new Date(now.getTime() + minutesFromNow * MINUTE);

  await prisma.$transaction(async (tx) => {
    const book = (patientId: bigint, scheduledAt: Date, doctorId = DOCTOR_ID) =>
      tx.appointment.create({ data: { doctorId, patientId, scheduledAt } });

    let position = 0;

    // 1. 진료 완료: 체크인 → 시작 → 완료 기록, 실제 진료시간으로 초진 EWMA를 쌓는다
    const config = await tx.algorithmConfig.findUnique({ where: { doctorId: DOCTOR_ID } });
    const alpha = config?.alpha ?? DEFAULT_ALGORITHM_CONFIG.alpha;
    const stat = await tx.serviceTimeStat.findUnique({
      where: { doctorId_serviceType: { doctorId: DOCTOR_ID, serviceType: "FIRST_VISIT" } },
    });
    let ewma = stat ? Number(stat.ewmaMinutes) : (config?.firstVisitTime ?? DEFAULT_ALGORITHM_CONFIG.firstVisitTime);
    let sampleCount = stat?.sampleCount ?? 0;

    let previousEnd = at(-COMPLETED[0].scheduledAgo);
    for (const item of COMPLETED) {
      const scheduledAt = at(-item.scheduledAgo);
      const appointment = await book(item.patientId, scheduledAt);
      const startedAt = new Date(Math.max(scheduledAt.getTime(), previousEnd.getTime()) + MINUTE);
      const completedAt = new Date(startedAt.getTime() + item.durationMinutes * MINUTE);
      await tx.queueEntry.create({
        data: {
          appointmentId: appointment.id,
          queuePosition: ++position,
          status: "COMPLETED",
          checkedInAt: new Date(scheduledAt.getTime() - 5 * MINUTE),
          calledAt: startedAt,
          startedAt,
          completedAt,
        },
      });
      ewma = calculateEWMA(ewma, item.durationMinutes, alpha);
      sampleCount += 1;
      previousEnd = completedAt;
    }

    await tx.serviceTimeStat.upsert({
      where: { doctorId_serviceType: { doctorId: DOCTOR_ID, serviceType: "FIRST_VISIT" } },
      update: { ewmaMinutes: ewma, sampleCount },
      create: { doctorId: DOCTOR_ID, serviceType: "FIRST_VISIT", ewmaMinutes: ewma, sampleCount },
    });

    // 2. 진료 중
    const inProgress = await book(IN_PROGRESS.patientId, at(-IN_PROGRESS.scheduledAgo));
    await tx.queueEntry.create({
      data: {
        appointmentId: inProgress.id,
        queuePosition: ++position,
        status: "IN_PROGRESS",
        checkedInAt: at(-IN_PROGRESS.scheduledAgo - 3),
        calledAt: at(-IN_PROGRESS.startedAgo),
        startedAt: at(-IN_PROGRESS.startedAgo),
      },
    });

    // 3. 체크인 후 대기
    for (const item of WAITING) {
      const appointment = await book(item.patientId, at(-item.scheduledAgo));
      await tx.queueEntry.create({
        data: {
          appointmentId: appointment.id,
          queuePosition: ++position,
          status: "CHECKED_IN",
          checkedInAt: at(-item.scheduledAgo - 2),
        },
      });
    }

    // 4. 오늘 늦게 올 예약 (대기 항목 없음 → 화면·API에서 체크인 시연)
    for (const item of BOOKED_LATER) {
      await book(item.patientId, at(item.scheduledIn));
    }

    // 5. 시연 환자의 내일 예약 (환자용 화면 '예정된 예약' 탭)
    const tomorrow = new Date(todayEnd.getTime() + 14 * 60 * MINUTE); // 내일 14:00 KST
    await book(DEMO_PATIENT_ID, tomorrow, OTHER_DOCTOR_ID);
  });

  console.log("시연 데이터를 만들었습니다. (13번 의사: 완료 3, 진료 중 1, 대기 3, 오늘 예약 2 / 4번 환자: 내일 예약 1)");
  console.log("13번 의사의 갱신된 초진 EWMA는 GET /api/doctors/13/service-time-stats 로 확인할 수 있습니다.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
