// Prisma singleton — hot-reload-safe (dev's module reload would otherwise
// spin up a fresh PrismaClient/connection pool on every save). Prisma 7
// dropped its Rust query engine in favor of driver adapters, so the client
// needs one passed in explicitly rather than resolving a schema `url`.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
