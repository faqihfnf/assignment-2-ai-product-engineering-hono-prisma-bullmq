import type { ConnectionOptions, JobsOptions } from "bullmq";
import { env } from "../config/env";

export const QUEUE_NAME = "study-guide-queue";
export const JOB_NAME = "generate-study-guide";

export type StudyGuideJobData = { jobId: string };

export const redisConnection: ConnectionOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
};

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
};
