import { Router, Request, Response } from 'express';
import { QueueStatus } from '@prisma/client';
import { prisma } from '../prisma';
import { calculateEWMA, calculateQueueWaitTimes, QueueItem } from '../services/calculator';

const router = Router();


// id 검증 헬퍼 함수
function parseId(value: unknown, field: string): bigint {
    const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof text !== 'string' || !/^[1-9]\d*$/.test(text)) {
        throw new Error(`4{field} must be a positive integer`);
    }
    return BigInt(text);
}


//api 엔드포인트 정의 
router.patch('/api/queue-entries/:id/status', async (req: Request, res: Response) => {
    const queueEntryId = parseId(req.params.id, 'id');
    const { status } = req.body as { status: QueueStatus };

    const now = new Date();

    const targetEntry = await prisma.queueEntry.findUnique({
        where: { id: queueEntryId },
        include: { appointment: true },
    });

    if (!targetEntry) {
        res.status(404).json({ error: 'Queue entry not found '});
        return;
    }

    const doctorId = targetEntry.appointment.doctorId;

    const updateData: any = { status };
    if (status === 'IN_PROGRESS') {
        updateData.startedAt = now; // 진료 시작 시각 기록
    } else if (status === 'COMPLETED') {
        updateData.completedAt = now; // 진료 완료 시각 기록
    }

    const updatedEntry = await prisma.queueEntry.update({
        where: { id: queueEntryId },
        data: updateData,
    });

    let newEWMA: number | null = null;
    let recalculatedQueue: any[] = [];


    // [진료 완료] 시 핵심 알고리즘 트리거
    if (status === 'COMPLETED' && targetEntry.startedAt) {
        
        // 직전 진료의 실제 소요시간(분) 연산
        const actualDurationMinutes = Math.max(
            1,
            Math.round((now.getTime() - new Date(targetEntry.startedAt).getTime()) / (1000 * 60))
        );

        // calculator.ts의 calculateEWMA()를 호출하여 새로운 EWMA 계산
        const stat = await prisma.serviceTimeStat.findUnique({
            where: {
                doctorId_serviceType: { doctorId, serviceType: 'general' }, 
            },
        });

        const currentEWMA = stat ? Number(stat.ewmaMinutes) : 10.0;
        const alpha = 0.3;

        newEWMA = calculateEWMA(currentEWMA, actualDurationMinutes, alpha);

        
        // 갱신된 EWMA 값을 DB(ServiceTimeStat 테이블)에 저장
        await prisma.serviceTimeStat.upsert({
            where: { doctorId_serviceType: { doctorId, serviceType: 'general' } },
            update: {
                ewmaMinutes: newEWMA,
                sampleCount: { increment: 1 },
            },
            create: {
                doctorId,
                serviceType: 'general',
                ewmaMinutes: newEWMA,
                sampleCount: 1,
            },
        });

        // 남은 대기자(CHECKED_IN) 목록 조회
        const remainingWaitingEntries = await prisma.queueEntry.findMany({
            where: {
                status: 'CHECKED_IN',
                appointment: { doctorId },
            },
            include: { appointment: true },
            orderBy: { queuePosition: 'asc'},
        });

        const waitingList: QueueItem[] = remainingWaitingEntries.map((entry) => ({
            ticketId: Number(entry.id),
            appointmentTime: entry.appointment.scheduledAt,
            isFirstVisit: false,
        }));


        // calculator.ts의 calculateQueueWaitTimes()로 남은 환자 전체 대기시간 재계산
        recalculatedQueue = calculateQueueWaitTimes(
            waitingList,
            newEWMA,
            now
        );
    }

    res.json({
        data: {
            updatedEntry: {
                ...updatedEntry,
                id: updatedEntry.id.toString(),
                appointmentId: updatedEntry.appointmentId.toString(),
                status: updatedEntry.status.toLowerCase(),
            }, // 상태가 변경된 현재 환자 정보
            updatedEWMA: newEWMA, // 갱신된 의사의 EWMA
            recalculatedQueue, // 남은 대기자들의 재계산된 예상시간 리스트
        },
    });
});

export default router;