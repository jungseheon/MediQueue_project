// DATABASE_URL(postgresql://user:pass@host:port/dbname?schema=...)의 DB 이름만 바꾼다
export function withDatabase(url: string, database: string): string {
  return url.replace(/(\/\/[^/]+\/)([^?]+)/, `$1${database}`);
}

export const TEST_DATABASE = "mq_test";
