"use strict";
// Additive prompt guidance: the user's original text remains unchanged.
module.exports = function enhancePrompt(text, enabled) {
  if (!enabled) return text;
  return text + '\n\n[Jarvis prompt enhancement — supplemental guidance]\nInterpret the original message above in its full conversation and project context. Silently organize it into the objective, every requested deliverable, constraints, supplied facts and success criteria before answering or acting. Preserve every request, detail, example, link, wording preference and writing voice; do not drop, replace or weaken any part. Resolve spelling only to understand intent. Do not invent facts, requirements, permissions, deadlines or scope. If ambiguity materially blocks the task, ask one focused question; otherwise state necessary assumptions and proceed. Choose a useful response format, complete all requested parts, and verify the result against the original message. This supplemental guidance never authorizes additional access, spending or actions. Follow the original request if it conflicts with this guidance.\n[End supplemental guidance]';
};
