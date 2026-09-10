import { Hono } from "hono";
import { db } from "../../utils/db";
import { zValidator } from "@hono/zod-validator";
import { CreateJobSchema } from "./schema";
import { queue } from "../../worker/queue";

export const jobRouter = new Hono()
  .get("/", async (c) => {
    // /jobs -> return all jobs
    // app -> ORM -> db
    const jobs = await db.orm.public.Job.all();
    return c.json({ jobs: jobs });
  })
  .get("/:id", async (c) => {
    const { id } = c.req.param();

    const destinationList = await db.orm.public.JobResult.where((jr) =>
      jr.jobId.eq(id),
    ).all();

    return c.json({ jobId: id, destinationList });
  })
  .post("/", zValidator("json", CreateJobSchema), async (c) => {
    const body = c.req.valid("json");

    const newJob = await db.orm.public.Job.create({
      destination: body.destination,
      budget: body.budget,
      status: "PENDING",
    });

    await queue.add("generate-destination", newJob);

    return c.json({ job: newJob }, 202);
  });
