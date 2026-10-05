import { db } from "../../utils/db";
import { JobStatus } from "./status";

// Base query for every read endpoint: a job together with its (optional) study guide.
export const jobsWithGuide = () => db.orm.public.StudyJob.include("guide");

type StudyJobRow = NonNullable<Awaited<ReturnType<ReturnType<typeof jobsWithGuide>["first"]>>>;

// Shape returned by every /jobs endpoint. `result` stays null until the guide is saved.
export function toJobResponse(job: StudyJobRow) {
  const guide = job.status === JobStatus.COMPLETED ? job.guide : null;

  return {
    id: job.id,
    status: job.status,
    step: job.step,
    input: {
      topic: job.topic,
      level: job.level,
      hasMaterial: job.material !== null,
    },
    attempts: job.attempts,
    error: job.error,
    createdAt: job.createdAt.toString(),
    finishedAt: job.finishedAt?.toString() ?? null,
    result: guide
      ? {
          title: guide.title,
          overview: guide.overview,
          objectives: guide.objectives,
          concepts: guide.concepts,
          quiz: guide.quiz,
        }
      : null,
  };
}
