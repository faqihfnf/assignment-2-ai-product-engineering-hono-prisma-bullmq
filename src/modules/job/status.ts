export const JobStatus = {
  QUEUED: "QUEUED",
  PROCESSING: "PROCESSING",
  RETRYING: "RETRYING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

// The pipeline steps, in order. Saved on the job so clients can follow progress.
export const PipelineStep = {
  OUTLINE: "outline",
  EXPLAIN: "explain",
  QUIZ: "quiz",
  SAVE: "save",
} as const;

export type PipelineStep = (typeof PipelineStep)[keyof typeof PipelineStep];
