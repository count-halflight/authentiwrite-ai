#!/usr/bin/env bash
set -euo pipefail
python - <<'PY'
import nltk
for item in ('punkt','punkt_tab'):
    nltk.download(item, quiet=True)
PY
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}"
