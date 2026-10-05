import { Queue } from "bullmq";
import { defaultJobOptions, JOB_NAME, QUEUE_NAME, redisConnection, type StudyGuideJobData } from "./config";

export const studyGuideQueue = new Queue<StudyGuideJobData>(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions,
});

export function enqueueStudyGuide(jobId: string) {
  // Reuse the database id as the BullMQ id so the same job can never be queued twice.
  return studyGuideQueue.add(JOB_NAME, { jobId }, { jobId });
}
