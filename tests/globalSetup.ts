import { execSync } from "child_process";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config();

function getUrls() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL이 .env에 설정되지 않았습니다");
  const testUrl = url.replace(/(\/\/[^/]+\/)([^?]+)/, "$1mq_test");
  // 관리 작업(CREATE/DROP DATABASE)은 postgres 유지보수 DB에 연결
  const adminUrl = url.replace(/(\/\/[^/]+\/)([^?]+)/, "$1postgres");
  return { testUrl, adminUrl };
}

export async function setup() {
  const { testUrl, adminUrl } = getUrls();

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  // 이전 실행에서 남은 DB가 있으면 삭제 후 재생성
  await client.query("DROP DATABASE IF EXISTS mq_test");
  await client.query("CREATE DATABASE mq_test");
  await client.end();

  // 테스트 DB에 migration 적용
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "pipe",
  });
}

export async function teardown() {
  const { adminUrl } = getUrls();
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  await client.query("DROP DATABASE IF EXISTS mq_test");
  await client.end();
}
