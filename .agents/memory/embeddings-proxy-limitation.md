---
name: No embeddings endpoint via Replit OpenAI AI-integrations proxy
description: The managed OpenAI integration only exposes chat/completions-style APIs, not the embeddings API — affects any retrieval/semantic-search feature.
---

The `@workspace/integrations-openai-ai-server` proxy (Replit AI Integrations) does not support OpenAI's embeddings endpoint, only chat completions (and related generation APIs).

**Why:** confirmed by reading the `ai-integrations-openai` skill; there is no embeddings-capable route documented or available through the proxy base URL.

**How to apply:** for any feature that calls for "embedding similarity" or vector search, either (a) check other AI integrations (e.g. Gemini) for embeddings support, or (b) substitute a local lightweight semantic score (e.g. character n-gram TF-IDF cosine) combined with real BM25/keyword retrieval, and clearly document the substitution in code comments. Prefer surfacing this deviation to the user before implementing rather than only noting it in code — it materially changes retrieval-quality expectations.
