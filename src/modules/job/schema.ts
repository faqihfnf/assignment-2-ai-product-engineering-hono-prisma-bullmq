import z from "zod";
import { JobStatus } from "./status";

export const LEVELS = ["beginner", "intermediate", "advanced"] as const;

export const CreateJobSchema = z.object({
  topic: z.string().trim().min(3).max(200),
  level: z.enum(LEVELS).default("beginner"),
  // Optional notes/article text. When given, the guide is grounded in it.
  material: z.string().trim().min(50).max(20_000).optional(),
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;

export const ListJobsQuerySchema = z.object({
  status: z.enum(Object.values(JobStatus) as [JobStatus, ...JobStatus[]]).optional(),
});
