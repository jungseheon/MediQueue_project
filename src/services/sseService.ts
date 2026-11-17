import type { Response } from "express";

class SSEService {
  // doctorId(문자열)별로 접속한 클라이언트 Response 목록
  private clients: Map<string, Response[]> = new Map();

  // 클라이언트 스트림 연결 추가
  public addClient(doctorId: string, res: Response): void {
    const existing = this.clients.get(doctorId) ?? [];
    this.clients.set(doctorId, [...existing, res]);
  }

  // 클라이언트 연결 종료 시 제거
  public removeClient(doctorId: string, res: Response): void {
    const remaining = (this.clients.get(doctorId) ?? []).filter((client) => client !== res);
    if (remaining.length > 0) {
      this.clients.set(doctorId, remaining);
    } else {
      this.clients.delete(doctorId);
    }
  }

  // 특정 진료실(doctorId)의 모든 구독자에게 최신 대기열 데이터 전송
  public broadcastQueueUpdate(doctorId: string, payload: unknown): void {
    const targetClients = this.clients.get(doctorId) ?? [];
    const formattedData = `data: ${JSON.stringify(payload)}\n\n`;

    targetClients.forEach((client) => {
      client.write(formattedData);
    });
  }
}

export const sseService = new SSEService();
