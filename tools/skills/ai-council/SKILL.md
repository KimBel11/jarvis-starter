---
name: ai-council
description: Run an AI council for a big decision. Several models from different labs answer the same question in parallel, each with a different role, and one randomly chosen model writes a one-page brief and a short audio summary. Use when @@NAME@@ faces a real decision (strategy, launch, pricing, spending) and wants more than one opinion. The council informs the decision; it never makes it.
---

# AI council

A second, third and fourth opinion, structured. (The method is adapted in our own words from the public "AI Council" idea of running several models in parallel with distinct roles; it is not a copy of any guide.)

## When to use it
Real decisions with trade-offs and real money or reputation at stake. Not for simple questions, single-file edits or anything one agent can settle.

## How it works
1. **Context.** One page: the goal, the constraints, what @@NAME@@ already knows, what a good outcome looks like. Short beats long.
2. **Roles on different models.** Give each a role and a different model so they do not share the same blind spot:
   - Research: the facts and current information (Gemini with Google Search if available, otherwise Claude Sonnet).
   - Strategy: options, trade-offs and a leaning (Claude Opus, high).
   - Builder: what it takes in practice, steps, risks (Codex GPT-6.1-Sol, high).
   - Skeptic: what could go wrong and which assumptions are weak (a cheaper model, low effort).
3. **Parallel, read-only.** Every role answers independently in at most 250 words. No role sees the others.
4. **Chair.** One model, chosen at random from those that answered, writes:
   - a one-page brief: the question, where the models agree, where they disagree, the main options with their trade-offs, the main risks, and what to check next;
   - an audio summary of 60 to 110 words in plain spoken language, for listening only.
5. **@@NAME@@ decides.** The brief lists options. It never says "you must".

## Cost control
- Say how many calls it will make before running (roles + 1) and wait for a yes.
- Keep context and answers short. Use cheaper models for simpler roles. Set a spending cap per call.

## In Jarvis
Open **Council** in the sidebar, write the question, optionally add a context file, press Estimate and run. The result appears as role answers, the brief and an audio summary you can play without reading.
