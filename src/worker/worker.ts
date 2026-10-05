import { UnrecoverableError, Worker, type Job } from "bullmq";
import { env } from "../config/env";
import { db, now } from "../utils/db";
import { runStudyGuidePipeline } from "../modules/job/service";
import { JobStatus, PipelineStep } from "../modules/job/status";
import { QUEUE_NAME, redisConnection, type StudyGuideJobData } from "./config";

if (!env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is empty. Set it in .env before starting the worker.");
  process.exit(1);
}

const jobs = () => db.orm.public.StudyJob;

function isFinalAttempt(job: Job, err: unknown) {
  if (err instanceof UnrecoverableError) return true;
  // attemptsMade counts previous failures, so this attempt is number attemptsMade + 1.
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

async function processStudyGuide(job: Job<StudyGuideJobData>) {
  const { jobId } = job.data;
  const tag = `[${jobId.slice(0, 8)}]`;

  const record = await jobs().where({ id: jobId }).first();
  if (!record) {
    throw new UnrecoverableError(`StudyJob ${jobId} does not exist`);
  }
  if (record.status === JobStatus.COMPLETED) {
    console.log(`${tag} already completed, skipping`);
    return;
  }

  await jobs().where({ id: jobId }).update({
    status: JobStatus.PROCESSING,
    attempts: job.attemptsMade + 1,
    error: null,
  });
  console.log(`${tag} attempt ${job.attemptsMade + 1}: "${record.topic}" (${record.level})`);

  try {
    const guide = await runStudyGuidePipeline(
      { topic: record.topic, level: record.level, material: record.material },
      async (step) => {
        console.log(`${tag} step -> ${step}`);
        await jobs().where({ id: jobId }).update({ step });
        await job.updateProgress({ step });
      },
    );

    // Result and final status are written together, so a job is never COMPLETED without its guide.
    await db.transaction(async (tx) => {
      await tx.orm.public.StudyJob.where({ id: jobId }).update({ step: PipelineStep.SAVE });
      await tx.orm.public.StudyGuide.where({ jobId }).delete();
      await tx.orm.public.StudyGuide.create({ jobId, ...guide });
      await tx.orm.public.StudyJob.where({ id: jobId }).update({
        status: JobStatus.COMPLETED,
        finishedAt: now(),
      });
    });

    console.log(`${tag} completed: ${guide.concepts.length} concepts, ${guide.quiz.length} questions`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const final = isFinalAttempt(job, err);

    await jobs()
      .where({ id: jobId })
      .update({
        status: final ? JobStatus.FAILED : JobStatus.RETRYING,
        error: message,
        finishedAt: final ? now() : null,
      });

    console.error(`${tag} ${final ? "FAILED" : "will retry"}: ${message}`);
    throw err;
  }
}

export const worker = new Worker<StudyGuideJobData>(QUEUE_NAME, processStudyGuide, {
  connection: redisConnection,
  concurrency: 2,
});

worker.on("ready", () => console.log(`Worker listening on "${QUEUE_NAME}" (model: ${env.OPENAI_MODEL})`));
worker.on("error", (err) => console.error("Worker error:", err.message));

async function shutdown() {
  console.log("Shutting down worker...");
  await worker.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
