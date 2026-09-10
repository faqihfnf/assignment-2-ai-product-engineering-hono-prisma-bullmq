import { Worker } from "bullmq";
import { QUEUE_NAME, workerConnection } from "./config";
import { db } from "../utils/db";
import { generateDestinationList } from "../modules/job/service";

export const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`Processing job: ${job.data.id}`);

    const jobId = job.data.id;
    if (!jobId) {
      throw new Error("Job ID is missing");
    }

    const jobData = await db.orm.public.Job.where((job) =>
      job.id.eq(jobId),
    ).first();
    console.log(jobData);

    if (!jobData?.destination || !jobData?.budget) {
      throw new Error(`Job with ID ${jobId} not found`);
    }

    const destinationList = await generateDestinationList(
      jobData?.destination,
      jobData?.budget,
    );

    // Save to DB
    console.log("Destination has been generated successfully");
    console.log(destinationList);

    const destinationListWithId = destinationList.destinations.map((d) => {
      return {
        jobId: jobData.id,
        name: d.name,
        description: d.description,
        location: d.location,
      };
    });

    await db.orm.public.JobResult.createAll(destinationListWithId);
    await db.orm.public.Job.where((job) => job.id.eq(jobId)).update({
      status: "COMPLETED",
    });
  },
  {
    connection: workerConnection,
  },
);
