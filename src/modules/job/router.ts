import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, now } from "../../utils/db";
import { enqueueStudyGuide } from "../../worker/queue";
import { CreateJobSchema, ListJobsQuerySchema } from "./schema";
import { JobStatus } from "./status";
import { jobsWithGuide, toJobResponse } from "./presenter";

// Turn zod errors into a consistent 400 body instead of the default validator output.
const validationHook = (result: { success: boolean; error?: { issues: unknown } }, c: Context) => {
  if (!result.success) {
    return c.json({ error: "Invalid request", issues: result.error?.issues }, 400);
  }
};

export const jobRouter = new Hono()
  .post("/", zValidator("json", CreateJobSchema, validationHook), async (c) => {
    const body = c.req.valid("json");

    const job = await db.orm.public.StudyJob.create({
      topic: body.topic,
      level: body.level,
      material: body.material ?? null,
      status: JobStatus.QUEUED,
    });

    try {
      await enqueueStudyGuide(job.id);
    } catch (err) {
      // Don't leave a QUEUED row that no worker will ever pick up.
      await db.orm.public.StudyJob.where({ id: job.id }).update({
        status: JobStatus.FAILED,
        error: "Could not enqueue job (is Redis running?)",
        finishedAt: now(),
      });
      console.error("Enqueue failed:", err);
      return c.json({ error: "Queue unavailable, try again later", id: job.id }, 503);
    }

    return c.json({ id: job.id, status: job.status }, 202);
  })
  .get("/", zValidator("query", ListJobsQuerySchema, validationHook), async (c) => {
    const { status } = c.req.valid("query");

    let query = jobsWithGuide();
    if (status) query = query.where({ status });
    const rows = await query.orderBy((j) => j.createdAt.desc()).all();

    return c.json({ total: rows.length, data: rows.map(toJobResponse) }, 200);
  })
  .get("/:id", async (c) => {
    const { id } = c.req.param();

    const job = await jobsWithGuide().where({ id }).first();
    if (!job) {
      return c.json({ error: `Job ${id} not found` }, 404);
    }

    return c.json(toJobResponse(job), 200);
  });
