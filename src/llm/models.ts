import { OpenAIClient } from "@anvia/openai";
import { env } from "../config/env";

export const client = new OpenAIClient({
  apiKey: env.OPENAI_API_KEY,
  baseUrl: env.OPENAI_BASE_URL || undefined,
});

export function getModel(modelId = env.OPENAI_MODEL) {
  return client.completionModel({ modelId });
}
