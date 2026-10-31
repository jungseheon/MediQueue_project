export function calculateEWMA(
    currentEWMA: number,
    actualTime: number,
    alpha: number = 0.3
): number {
    // EWMA_t = alpha * X_t + (1 - alpha) * currentEWMA
    const newEWMA = alpha * actualTime + (1 - alpha) * currentEWMA;
    return Number(newEWMA.toFixed(1));
}

export interface QueueItem {
    ticketId: number;
    appointmentTime: Date;
    isFirstVisit: boolean;
}

export interface CalculatedResult {
    ticketId: number;
    estimatedStartTime: Date;
    delayMinutes: number;
    isAlertTriggered: boolean;
}

export function calculateQueueWaitTimes(
    waitingList: QueueItem[],
    currentEWMA: number,
    lastcompletionTime: Date,
    delayThreshold: number = 10,
    firstVisitTime: number = 12, 
    reVisitTime: number = 8,
    prepTime: number = 1
): CalculatedResult[] {
    let prevCompletionTime = new Date(lastcompletionTime);

    return waitingList.map((patient) => {
        const appointmentTime = new Date(patient.appointmentTime);

        const estimatedStartTime = new Date(
            Math.max(appointmentTime.getTime(), prevCompletionTime.getTime())
        );

        const diffMs = estimatedStartTime.getTime() - appointmentTime.getTime();
        const delayMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));

        const baseTime = patient.isFirstVisit ? firstVisitTime : reVisitTime;
        const estimatedDuration = (currentEWMA / baseTime) * baseTime + prepTime;

        prevCompletionTime = new Date(estimatedStartTime.getTime() + estimatedDuration * 60 * 1000);

        return {
            ticketId: patient.ticketId,
            estimatedStartTime,
            delayMinutes,
            isAlertTriggered: delayMinutes >= delayThreshold,
        };
    });
}