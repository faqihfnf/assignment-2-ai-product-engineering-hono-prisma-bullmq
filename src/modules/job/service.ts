import z from "zod";
import { generateCompletion } from "@anvia/core";
import { getModel } from "../../llm/models";

const DestinationSchema = z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
});

const DestinationListSchema = z.object({
  destinations: z.array(DestinationSchema),
});

const SYSTEM_INSTRUCTIONS =
  "You are a travel expert. Generate a list of 2 unique travel destinations with their name, description, and location in JSON format";

export async function generateDestinationList(
  destination: string,
  budget: string,
) {
  console.log(`Generating destination list for: ${destination}`);

  const PROMPT = `Generate a list of 2 unique travel destinations with their name, description, and location in JSON format.
    The destinations should be related to ${destination} and within a budget of ${budget}.`;

  const res = await generateCompletion({
    model: getModel(),
    prompt: PROMPT,
    instructions: SYSTEM_INSTRUCTIONS,
    outputSchema: DestinationListSchema,
  });

  console.log("Generating Done!");

  return res.output;
}
