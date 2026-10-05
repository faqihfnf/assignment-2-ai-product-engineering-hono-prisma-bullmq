import z from "zod";
import { UnrecoverableError } from "bullmq";
import { generateCompletion } from "@anvia/core";
import { getModel } from "../../llm/models";
import { PipelineStep } from "./status";

/**
 * Study guide pipeline:
 *   1. outline  -> check the topic is learnable, pick objectives + key concepts
 *   2. explain  -> explain every concept with an example and a common mistake
 *   3. quiz     -> write multiple-choice questions that test those concepts
 * Each step is a separate model call that builds on the previous step's output.
 */

export type PipelineInput = {
  topic: string;
  level: string;
  material: string | null;
};

const OutlineSchema = z.object({
  learnable: z.boolean(),
  rejectionReason: z.string(),
  title: z.string(),
  overview: z.string(),
  objectives: z.array(z.string()),
  concepts: z.array(z.object({ name: z.string(), whyItMatters: z.string() })),
});

const ExplanationSchema = z.object({
  concepts: z.array(
    z.object({
      name: z.string(),
      explanation: z.string(),
      example: z.string(),
      commonMistake: z.string(),
    }),
  ),
});

const QuizSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      answerIndex: z.number().int(),
      explanation: z.string(),
    }),
  ),
});

export type StudyGuideOutput = {
  title: string;
  overview: string;
  objectives: string[];
  concepts: z.infer<typeof ExplanationSchema>["concepts"];
  quiz: z.infer<typeof QuizSchema>["questions"];
};

const TUTOR =
  "You are a patient, accurate tutor who writes study guides. Always answer in the same language as the topic. Never invent facts; prefer well-established knowledge.";

function materialBlock(material: string | null) {
  return material
    ? `\n\nBase the guide on this source material (stay faithful to it):\n"""\n${material}\n"""`
    : "";
}

async function outline(input: PipelineInput) {
  const res = await generateCompletion({
    model: getModel(),
    instructions: TUTOR,
    outputSchema: OutlineSchema,
    prompt: `Plan a study guide for a ${input.level} learner.
Topic: "${input.topic}"${materialBlock(input.material)}

First decide if the topic is something that can actually be studied (not gibberish, not empty, not harmful).
If it is not, set learnable=false, explain why in rejectionReason, and leave the other fields short or empty.
Otherwise set learnable=true, rejectionReason="", and return:
- title: a clear guide title
- overview: 2-3 sentences describing what the learner will get
- objectives: 3-5 concrete learning objectives, each starting with an action verb (e.g. "Explain ...", "Compare ..."), written in the topic's language
- concepts: 3-5 key concepts in the order they should be learned`,
  });

  const data = res.output;
  if (!data.learnable) {
    // Bad input will not get better by retrying, so stop immediately.
    throw new UnrecoverableError(`Topic rejected: ${data.rejectionReason || "not a learnable topic"}`);
  }
  if (data.concepts.length === 0 || data.objectives.length === 0) {
    throw new Error("Outline step returned no concepts or objectives");
  }
  return data;
}

async function explain(input: PipelineInput, plan: z.infer<typeof OutlineSchema>) {
  const conceptList = plan.concepts.map((c, i) => `${i + 1}. ${c.name} - ${c.whyItMatters}`).join("\n");

  const res = await generateCompletion({
    model: getModel(),
    instructions: TUTOR,
    outputSchema: ExplanationSchema,
    prompt: `Study guide: "${plan.title}" (level: ${input.level}).
Explain each of these concepts, in this exact order:
${conceptList}${materialBlock(input.material)}

For every concept return: name, explanation (one short paragraph pitched at a ${input.level} learner),
a concrete example, and one common mistake learners make.`,
  });

  if (res.output.concepts.length === 0) {
    throw new Error("Explain step returned no concepts");
  }
  return res.output.concepts;
}

async function quiz(input: PipelineInput, concepts: StudyGuideOutput["concepts"]) {
  const notes = concepts.map((c) => `- ${c.name}: ${c.explanation}`).join("\n");

  const res = await generateCompletion({
    model: getModel(),
    instructions: TUTOR,
    outputSchema: QuizSchema,
    prompt: `Write 5 multiple-choice questions for a ${input.level} learner, based only on these notes:
${notes}

Each question must have exactly 4 options, one correct answer given as answerIndex (0-3),
and a one-sentence explanation of why that answer is correct.`,
  });

  // Keep only well-formed questions; the model occasionally slips on the index.
  const valid = res.output.questions.filter(
    (q) => q.options.length >= 2 && q.answerIndex >= 0 && q.answerIndex < q.options.length,
  );
  if (valid.length < 3) {
    throw new Error(`Quiz step produced only ${valid.length} valid questions`);
  }
  return valid;
}

export async function runStudyGuidePipeline(
  input: PipelineInput,
  onStep: (step: PipelineStep) => Promise<void>,
): Promise<StudyGuideOutput> {
  await onStep(PipelineStep.OUTLINE);
  const plan = await outline(input);

  await onStep(PipelineStep.EXPLAIN);
  const concepts = await explain(input, plan);

  await onStep(PipelineStep.QUIZ);
  const questions = await quiz(input, concepts);

  return {
    title: plan.title,
    overview: plan.overview,
    objectives: plan.objectives,
    concepts,
    quiz: questions,
  };
}
