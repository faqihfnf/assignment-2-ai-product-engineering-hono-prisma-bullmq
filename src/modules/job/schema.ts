import z from "zod";

export const CreateJobSchema = z.object({
  destination: z.string().max(255),
  budget: z.string().max(255),
});
