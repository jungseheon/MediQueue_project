import { defineConfig } from "vitest/config";
import dotenv from "dotenv";
import { TEST_DATABASE, withDatabase } from "./tests/testDatabase";

dotenv.config();

export default defineConfig({
  test: {
    // frontend/tests는 node:test로 따로 실행한다 (npm run test:patient)
    include: ["tests/**/*.test.ts"],
    // 테스트 파일을 순서대로 실행 (통합 테스트가 같은 DB를 공유하므로 필수)
    fileParallelism: false,
    globalSetup: ["./tests/globalSetup.ts"],
    // 테스트 프로세스의 DATABASE_URL을 테스트 DB로 교체
    env: {
      DATABASE_URL: process.env.DATABASE_URL
        ? withDatabase(process.env.DATABASE_URL, TEST_DATABASE)
        : "",
    },
  },
});
