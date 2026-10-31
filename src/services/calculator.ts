export function calculateEWMA(
    currentEWMA: number, // 기존 EWMA (예: 14.2분)
    actualTime: number, // 방금 완료된 환자의 실제 소요시간 X_t (예: 18분)
    alpha: number = 0.3
): number {
    // EWMA_t = alpha * X_t + (1 - alpha) * currentEWMA
    const newEWMA = alpha * actualTime + (1 - alpha) * currentEWMA;
    return Number(newEWMA.toFixed(1)); // 소수점 첫째자리 반올림
}

export interface QueueItem {
    ticketId: number;
    appointmentTime: Date; // 원래 예약시간 (A_i)
    isFirstVisit: boolean; // 초진 여부
}

export interface CalculatedResult {
    ticketId: number;
    estimatedStartTime: Date; // 예상 시작시각 (S_i)
    delayMinutes: number; // 예상 지연시간 (D_i)
    isAlertTriggered: boolean; // 알림 발송 대상 여부
}

export function calculateQueueWaitTimes(
    waitingList: QueueItem[],
    currentEWMA: number,
    lastcompletionTime: Date, // 직전 환자 완료 시각 (C_(i-1))
    delayThreshold: number = 10, // 지연 알림 기준
    firstVisitTime: number = 12, // 초진 기본시간
    reVisitTime: number = 8, // 재진 기본시간 
    prepTime: number = 1 // 환자 교체 준비시간
): CalculatedResult[] {
    let prevCompletionTime = new Date(lastcompletionTime);

    return waitingList.map((patient) => {
        const appointmentTime = new Date(patient.appointmentTime); // 원래 예약 시각

        // S_i = max(A_i, C_(i-1))
        const estimatedStartTime = new Date(
            Math.max(appointmentTime.getTime(), prevCompletionTime.getTime())
        ); 

        // D_i = max(0, S_i - A_i)
        const diffMs = estimatedStartTime.getTime() - appointmentTime.getTime();
        const delayMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60))); // 분 단위 변환

        // 현재 환자 예상 소요시간 계산
        const baseTime = patient.isFirstVisit ? firstVisitTime : reVisitTime;
        const estimatedDuration = (currentEWMA / baseTime) * baseTime + prepTime;

        prevCompletionTime = new Date(estimatedStartTime.getTime() + estimatedDuration * 60 * 1000); // 다음 환자를 위한 C_i 갱신

        // 결과 반환
        return {
            ticketId: patient.ticketId,
            estimatedStartTime,
            delayMinutes,
            isAlertTriggered: delayMinutes >= delayThreshold,
        };
    });
}