# AuthentiWrite AI v3

AuthentiWrite is a full-stack writing-analysis project centered on **Detect**, **Naturalize**, and **Compare**.

## Architecture

- **React + TypeScript + Vite** frontend
- **TMR RoBERTa ONNX** detector running in the browser through Transformers.js
- **Python FastAPI** backend
- **NLTK Punkt** sentence segmentation for Compare and linguistic profiling
- MATTR + MTLD lexical diversity, multi-word connector analysis, sentence-rhythm metrics and short-sample warnings
- Optional **Gemini API** for the Naturalize editor, configured only through a server environment variable
- One Docker image serves both the React build and FastAPI API

No API key is stored in the source code. `.env` files are ignored by Git.

## Free deployment target

The repo includes `render.yaml` and a Dockerfile for a single Render Free web service. Render's free web service can sleep after inactivity, so the first request after an idle period can be slow.

### Required secret for full Naturalize

Create a Gemini API key in Google AI Studio and set it in Render as:

`GEMINI_API_KEY`

The source never exposes it to the browser. If the secret is absent, Naturalize falls back to conservative deterministic edits rather than failing completely.

## Local development

Backend:

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
cp .env.example .env
# set VITE_API_BASE_URL=http://localhost:8000
npm run dev
```

## Core design decisions

1. The trained TMR detector remains the primary detection signal. Hand-built style features are only a small cross-check and explanation layer.
2. Compare uses the Python sentence tokenizer when the backend is available and falls back to the browser parser while typing or offline.
3. Lexical diversity reports both MATTR-50 and MTLD and warns on short samples.
4. Naturalize uses route-based editing: already-good text gets a light pass; ordinary drafts get rewrite + critique + finalize; dense drafts get additional fidelity repair when necessary.
5. Names, numbers, dates, URLs, quotations, citations and technical details are protected during Naturalize.
6. Subtle natural variation is capped and source-safe; it is never allowed to alter factual anchors.

## Repository layout

```text
frontend/     React/Vite UI and browser detector
backend/      FastAPI NLP + Naturalize service
docs/         design/research notes
Dockerfile    one-service production build
render.yaml   Render free-tier blueprint
.github/      CI checks
```
