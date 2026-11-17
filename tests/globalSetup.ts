import { execSync } from "child_process";
import { Client } from "pg";
import dotenv from "dotenv";
import { TEST_DATABASE, withDatabase } from "./testDatabase";

dotenv.config();

function getUrls() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL이 .env에 설정되지 않았습니다");
  return {
    testUrl: withDatabase(url, TEST_DATABASE),
    // 관리 작업(CREATE/DROP DATABASE)은 postgres 유지보수 DB에 연결
    adminUrl: withDatabase(url, "postgres"),
  };
}

async function dropTestDatabase(adminUrl: string, recreate: boolean) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE}`);
  if (recreate) await client.query(`CREATE DATABASE ${TEST_DATABASE}`);
  await client.end();
}

export async function setup() {
  const { testUrl, adminUrl } = getUrls();
  // 이전 실행에서 남은 DB가 있으면 삭제 후 재생성
  await dropTestDatabase(adminUrl, true);

  // 테스트 DB에 migration 적용
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "pipe",
  });
}

export async function teardown() {
  await dropTestDatabase(getUrls().adminUrl, false);
}
