import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // A burst of requests (or a heavy parallel test run) can briefly use every pooled connection; transactions wait longer for one
  // instead of failing after 2 seconds, and long jobs (term invoices, report cards) get 30 seconds before they are cut off.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }), transactionOptions: { maxWait: 10_000, timeout: 30_000 } });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];
