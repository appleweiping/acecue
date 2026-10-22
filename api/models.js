// GET /api/models: the provider list the UI shows. No secrets are returned.
import { handleModels } from "./_providers.js";

export const config = { runtime: "edge" };

export default function handler() {
  return handleModels(process.env);
}
