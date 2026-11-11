import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

dotenv.config();

// DATABASE_URL의 DB 이름 부분만 mq_test로 교체
const testDbUrl = (() => {
  const url = process.env.DATABASE_URL;
  if (!url) return "";
  // postgresql://user:pass@host:port/dbname?schema=... 형식 처리
  return url.replace(/(\/\/[^/]+\/)([^?]+)/, "$1mq_test");
})();

export default defineConfig({
  test: {
    // 테스트 파일을 순서대로 실행 (통합 테스트가 같은 DB를 공유하므로 필수)
    fileParallelism: false,
    globalSetup: ["./tests/globalSetup.ts"],
    // 테스트 프로세스의 DATABASE_URL을 테스트 DB로 교체
    env: {
      DATABASE_URL: testDbUrl,
    },
  },
});
