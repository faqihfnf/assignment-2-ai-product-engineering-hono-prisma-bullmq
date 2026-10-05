import "dotenv/config";
// Prisma Next reads/writes DateTime columns as Temporal values.
// Node < 26.8 has no global Temporal, so install the polyfill before the client is created.
import "temporal-polyfill/full/global";
import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma/contract";
import contractJson from "../generated/prisma/contract.json" with { type: "json" };

export const db = postgres<Contract>({
  contractJson,
  url: process.env["DATABASE_URL"]!,
});

export const now = () => Temporal.Now.instant();
