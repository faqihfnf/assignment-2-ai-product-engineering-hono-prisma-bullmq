import "dotenv/config";
import z from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6380),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.6-luna"),
});

const parsed = EnvSchema.safeParse({
  ...process.env,
  // Accept OPENAI_API_BASE_URL as an alias, some providers document that name.
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE_URL,
});

if (!parsed.success) {
  console.error("Invalid environment variables:", z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
