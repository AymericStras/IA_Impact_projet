# 0003 — Model-written texts are a separate, optional step

Date: 2026-10-10. Status: accepted (owner allowed the use of the project's OpenAI key).

**Decision.** `enrich.py` asks `gpt-5.4-mini` (the chatbot's model) for three
short texts and stores them in `education.insights`. `render_pdf` never calls
the network. The HTTP `/render` endpoint runs the step first when a key is
configured, and carries on without it on any failure.

**Why.**
- The owner wants PDF generation to be stable whatever happens; a model call is
  the one part that can time out, so it sits outside the renderer.
- A teacher must be able to read and edit the texts before parents see them;
  `/enrich` returns them as data for that.
- Deterministic guard rails (no number or century absent from the input, no
  link, no "acquired" claim) are cheaper and more reliable than a second model
  call, and they keep the rule "only the teacher certifies a competency".
- No SDK dependency: one `httpx` call to the Responses API with a strict JSON
  schema.

**Consequences.** Texts stay generic by design (the model is told not to bring
outside facts). The automatic path prints "not yet reviewed by the teacher".
Evaluation with the real model lives in `evals/` and is not part of `pytest`.
