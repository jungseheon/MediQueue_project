const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 서버 시간대와 관계없이 한국 시간(KST) 기준 하루의 시작·끝(다음 날 0시)을 구한다.
export function getKstDayRange(date: Date): { start: Date; end: Date } {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const start =
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

export function isSameKstDay(a: Date, b: Date): boolean {
  return getKstDayRange(a).start.getTime() === getKstDayRange(b).start.getTime();
}
