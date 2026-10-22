// POST /api/chat: streams a model reply. The logic lives in _providers.js.
import { handleChat } from "./_providers.js";

export const config = { runtime: "edge" };

export default function handler(req) {
  return handleChat(req, process.env);
}
