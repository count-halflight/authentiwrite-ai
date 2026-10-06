from __future__ import annotations

import json
import math
import os
import re
from collections import Counter
from statistics import mean, median, pstdev
from typing import Literal

import httpx
import nltk
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_NAME = 'AuthentiWrite AI v3'
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '').strip()
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash').strip()
FRONTEND_ORIGIN = os.getenv('FRONTEND_ORIGIN', '*').strip()

for resource in ('punkt', 'punkt_tab'):
    try:
        nltk.data.find(f'tokenizers/{resource}')
    except LookupError:
        try:
            nltk.download(resource, quiet=True)
        except Exception:
            pass

app = FastAPI(title=APP_NAME, version='3.0.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'] if FRONTEND_ORIGIN == '*' else [x.strip() for x in FRONTEND_ORIGIN.split(',') if x.strip()],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)

FORMAL_CONNECTORS = sorted({
    'it is important to note', 'it is worth noting', 'on the other hand', 'as a consequence', 'as a result',
    'for this reason', 'in light of this', 'in view of this', 'in addition to this', 'in addition', 'in contrast',
    'by contrast', 'despite this', 'in comparison', 'in the same way', 'at the same time', 'to illustrate',
    'for example', 'for instance', 'in particular', 'more specifically', 'more importantly', 'with regard to',
    'with respect to', 'in relation to', 'in conclusion', 'to conclude', 'in summary', 'to summarize',
    'taken together', 'all in all', 'on balance', 'first of all', 'to begin with', 'in the first place',
    'in the second place', 'at this point', 'in other words', 'that is to say', 'because of this', 'due to this',
    'owing to this', 'notwithstanding this', 'even so', 'nevertheless', 'nonetheless', 'however', 'moreover',
    'furthermore', 'additionally', 'consequently', 'therefore', 'accordingly', 'subsequently', 'similarly',
    'likewise', 'meanwhile', 'ultimately', 'overall', 'indeed', 'notably', 'significantly', 'specifically',
    'thus', 'hence', 'finally', 'firstly', 'secondly', 'thirdly', 'on the contrary', 'in spite of this',
    'for that reason', 'to put it differently', 'more to the point', 'in practical terms', 'in this respect',
}, key=len, reverse=True)

REFERENCE_PROFILE = {
    'avgSentence': (10.0, 28.0),
    'sentenceCv': (0.35, 0.85),
    'mattr': (0.55, 0.82),
    'mtld': (45.0, 120.0),
    'punctuationCv': (0.38, 1.25),
    'formalConnectorDensity': (0.0, 1.8),
    'repetitionRate': (0.0, 1.8),
}

WORD_RE = re.compile(r"[\w]+(?:['’-][\w]+)*", re.UNICODE)


def words(text: str) -> list[str]:
    return [x.lower().replace('’', "'") for x in WORD_RE.findall(text)]


def sentence_list(text: str) -> list[str]:
    clean = re.sub(r'\r\n?', '\n', text).strip()
    if not clean:
        return []
    try:
        out: list[str] = []
        for para in re.split(r'\n\s*\n+', clean):
            para = re.sub(r'\s+', ' ', para).strip()
            if para:
                out.extend(s.strip() for s in nltk.sent_tokenize(para, language='english') if s.strip())
        return out
    except Exception:
        # Closing quote/bracket aware fallback, while keeping common abbreviations intact.
        protected = clean
        abbreviations = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Rev.', 'Sr.', 'Jr.', 'e.g.', 'i.e.', 'etc.', 'vs.', 'a.m.', 'p.m.', 'Ph.D.']
        for i, abbr in enumerate(abbreviations):
            protected = protected.replace(abbr, f'__ABBR_{i}__')
        protected = re.sub(r'(\d)\.(\d)', r'\1__DOT__\2', protected)
        marked = re.sub(r'([.!?]+[\"”’\')\]\}»]*)(?=\s+\S)', r'\1<AUTHENTIWRITE_SENTENCE_BREAK>', protected)
        pieces = marked.split('<AUTHENTIWRITE_SENTENCE_BREAK>')
        restored = []
        for piece in pieces:
            for i, abbr in enumerate(abbreviations):
                piece = piece.replace(f'__ABBR_{i}__', abbr)
            piece = piece.replace('__DOT__', '.')
            if piece.strip():
                restored.append(piece.strip())
        return restored


def stdev(values: list[float]) -> float:
    return pstdev(values) if len(values) > 1 else 0.0


def mattr(tokens: list[str], window: int = 50) -> float:
    if not tokens:
        return 0.0
    if len(tokens) <= window:
        return len(set(tokens)) / len(tokens)
    vals = []
    step = 1 if len(tokens) <= 3000 else 5
    for start in range(0, len(tokens) - window + 1, step):
        part = tokens[start:start + window]
        vals.append(len(set(part)) / window)
    return mean(vals) if vals else 0.0


def _mtld_direction(tokens: list[str], threshold: float = 0.72) -> float:
    if not tokens:
        return 0.0
    types: set[str] = set()
    count = 0
    factors = 0.0
    last_ttr = 1.0
    for token in tokens:
        count += 1
        types.add(token)
        last_ttr = len(types) / count
        if last_ttr <= threshold:
            factors += 1.0
            count = 0
            types.clear()
            last_ttr = 1.0
    if count:
        factors += max(0.01, (1.0 - last_ttr) / (1.0 - threshold))
    return len(tokens) / max(0.01, factors)


def mtld(tokens: list[str]) -> float:
    if len(tokens) < 20:
        return float(len(set(tokens))) if tokens else 0.0
    return mean([_mtld_direction(tokens), _mtld_direction(list(reversed(tokens)))])


def connector_matches(text: str) -> list[str]:
    lower = text.lower().replace('’', "'")
    occupied: list[tuple[int, int]] = []
    found: list[tuple[int, str]] = []
    for phrase in FORMAL_CONNECTORS:
        pattern = re.compile(r'\b' + re.escape(phrase).replace(r'\ ', r'\s+') + r'\b', re.I)
        for m in pattern.finditer(lower):
            start, end = m.span()
            if any(start < b and end > a for a, b in occupied):
                continue
            occupied.append((start, end))
            found.append((start, phrase))
    return [phrase for _, phrase in sorted(found)]


def range_penalty(value: float, low: float, high: float, scale: float) -> float:
    if low <= value <= high:
        return 0.0
    delta = low - value if value < low else value - high
    return max(0.0, min(100.0, delta / scale * 100.0))


def profile(text: str) -> dict:
    ws = words(text)
    ss = sentence_list(text)
    lengths = [len(words(s)) for s in ss if words(s)]
    avg_sentence = mean(lengths) if lengths else 0.0
    sentence_cv = stdev(lengths) / avg_sentence if avg_sentence else 0.0

    token_stream = re.findall(r"[\w]+(?:['’-][\w]+)*|[,.!?;:—()\[\]]", text, flags=re.UNICODE)
    intervals: list[int] = []
    since_pause = 0
    punctuation_count = 0
    for tok in token_stream:
        if re.fullmatch(r'[,.!?;:—()\[\]]', tok):
            punctuation_count += 1
            if since_pause:
                intervals.append(since_pause)
            since_pause = 0
        else:
            since_pause += 1
    pause_mean = mean(intervals) if intervals else 0.0
    punctuation_cv = stdev(intervals) / pause_mean if pause_mean else 0.0

    connectors = connector_matches(text)
    connector_density = len(connectors) / len(ws) * 100 if ws else 0.0
    contractions = sum(1 for w in ws if "'" in w)
    nominalizations = sum(1 for w in ws if re.search(r'(tion|sion|ment|ity|ness|ance|ence)$', w))
    bigrams = [f'{ws[i]} {ws[i+1]}' for i in range(max(0, len(ws)-1))]
    repetition = (len(bigrams) - len(set(bigrams))) / len(ws) * 100 if ws else 0.0
    comma_density = text.count(',') / len(ws) * 100 if ws else 0.0
    counts = Counter(ws)
    hapax_ratio = sum(1 for n in counts.values() if n == 1) / len(ws) if ws else 0.0

    m = mattr(ws)
    mt = mtld(ws)
    lexical_penalty = (
        range_penalty(m, 0.55, 0.82, 0.32) * 0.11 + range_penalty(mt, 45, 120, 75) * 0.07
        if len(ws) >= 80 else range_penalty(m, 0.50, 0.88, 0.38) * 0.10
    )
    human_distance = min(100.0, max(0.0,
        range_penalty(sentence_cv, 0.35, 0.85, 0.50) * 0.24
        + range_penalty(punctuation_cv, 0.38, 1.25, 0.90) * 0.16
        + lexical_penalty
        + range_penalty(connector_density, 0, 1.8, 2.4) * 0.10
        + range_penalty(repetition, 0, 1.8, 2.6) * 0.11
        + range_penalty(avg_sentence, 10, 28, 20) * 0.07
    ))

    adjacent = [abs(lengths[i] - lengths[i-1]) for i in range(1, len(lengths))]
    micro = min(100.0, ((mean(adjacent) / avg_sentence) * 72 if avg_sentence and adjacent else 0) + punctuation_cv * 18)

    warnings: list[str] = []
    if len(ss) < 10:
        warnings.append(f'Only {len(ss)} sentences detected; rhythm and sentence-variation statistics are less stable below about 10 sentences.')
    if len(ws) < 100:
        warnings.append(f'Only {len(ws)} words detected; lexical-diversity measures are less stable on short samples.')

    return {
        'words': len(ws),
        'sentences': len(ss),
        'avgSentence': avg_sentence,
        'medianSentence': median(lengths) if lengths else 0.0,
        'sentenceCv': sentence_cv,
        'mattr': m,
        'mtld': mt,
        'lexicalIndex': (m * 100 + min(100, mt)) / 2,
        'hapaxRatio': hapax_ratio,
        'punctuationDensity': punctuation_count / len(ws) * 100 if ws else 0.0,
        'punctuationCv': punctuation_cv,
        'formalConnectorDensity': connector_density,
        'formalConnectorHits': len(connectors),
        'formalConnectorPhrases': connectors,
        'contractionDensity': contractions / len(ws) * 100 if ws else 0.0,
        'questionRate': sum(1 for s in ss if s.rstrip('”\'\")]}').endswith('?')) / len(ss) * 100 if ss else 0.0,
        'firstPersonDensity': sum(1 for w in ws if w in {'i','me','my','mine','we','us','our','ours'}) / len(ws) * 100 if ws else 0.0,
        'nominalizationDensity': nominalizations / len(ws) * 100 if ws else 0.0,
        'repetitionRate': repetition,
        'commaDensity': comma_density,
        'humanDistance': human_distance,
        'microIrregularity': micro,
        'sentenceLengths': lengths,
        'sentenceTexts': ss,
        'lexicalReliability': 'High' if len(ws) >= 200 else 'Medium' if len(ws) >= 100 else 'Low',
        'warnings': warnings,
        'referenceProfile': REFERENCE_PROFILE,
        'splitter': 'NLTK Punkt sentence tokenizer',
    }


def scan_patterns(text: str, p: dict | None = None) -> list[str]:
    p = p or profile(text)
    low = text.lower()
    ss = p['sentenceTexts']
    flags: list[str] = []
    def add(name: str):
        if name not in flags:
            flags.append(name)

    if re.search(r"\b(?:it(?:'s| is) not (?:just|only)|this (?:isn't|is not) (?:just|only)).{0,100}\b(?:but|rather|it(?:'s| is))\b", text, re.I | re.S): add('not-X-but-Y staging')
    if re.search(r'\b(?:at its core|what really matters|the bottom line is|the key takeaway|let that sink in)\b', low): add('saying-like conclusion')
    if re.search(r"\b(?:here(?:'s| is) the thing|let(?:'s| us) (?:dive|explore|unpack)|honestly\?|the truth is)\b", low): add('staged run-up')
    if re.search(r'\b(?:delve|testament|landscape|showcasing|pivotal|multifaceted|tapestry|seamlessly|underscore|transformative)\b', low): add('stock AI vocabulary')
    if p['formalConnectorDensity'] > 1.8: add('dense explicit signposting')
    if p['sentenceCv'] < 0.30 and p['sentences'] >= 5: add('uniform sentence rhythm')
    if p['punctuationCv'] < 0.34 and p['sentences'] >= 5: add('regular punctuation cadence')
    if p['repetitionRate'] > 1.5: add('repetitive phrasing')
    starts = [' '.join(words(s)[:2]) for s in ss if words(s)]
    if len(starts) - len(set(starts)) >= 2: add('repeated sentence openings')
    if len(re.findall(r'—', text)) >= max(3, int(max(1, p['sentences']) * 0.35)): add('dash-heavy linking')
    if len(re.findall(r',\s+\w+ing\b', text, re.I)) >= 3: add('stacked -ing riders')
    if re.search(r'\b(?:experts (?:say|believe)|studies show|research suggests|widely recognized)\b', low): add('borrowed authority without source')
    if re.search(r'\b(?:great question|i hope this helps|feel free to ask|certainly!|absolutely!)\b', low): add('chatbot residue')
    if p['nominalizationDensity'] > 5.5: add('abstract noun stacking')
    if ss and re.match(r'^(in conclusion|overall|ultimately|in summary|to conclude)\b', ss[-1].lower()): add('tidy summary ending')
    return flags


def stylometry_ai_index(p: dict, patterns: list[str]) -> float:
    # A weak cross-check only. It is intentionally not treated as a probability.
    if p['words'] < 80 or p['sentences'] < 4:
        return 50.0
    score = 50.0
    if p['sentenceCv'] < 0.25: score += 12
    elif p['sentenceCv'] > 0.50: score -= 4
    if p['punctuationCv'] < 0.28: score += 7
    elif p['punctuationCv'] > 0.58: score -= 3
    if p['formalConnectorDensity'] > 1.8: score += 7
    if p['repetitionRate'] > 1.8: score += 5
    if 'stock AI vocabulary' in patterns: score += 5
    if 'chatbot residue' in patterns: score += 6
    return max(12.0, min(88.0, score))


def protected_anchors(text: str) -> list[str]:
    patterns = [
        r'https?://\S+', r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b', r'\b\d+(?:\.\d+)?%?\b',
        r'\b(?:[A-Z]{2,}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b', r'[“\"]([^”\"]{2,120})[”\"]',
        r'\([^)]{2,100}\)',
    ]
    anchors: list[str] = []
    for pat in patterns:
        for m in re.finditer(pat, text):
            val = m.group(0).strip()
            if val and val not in anchors:
                anchors.append(val)
    return anchors[:80]


def anchor_preservation(original: str, rewrite: str) -> float:
    anchors = protected_anchors(original)
    if not anchors:
        return 100.0
    preserved = sum(1 for a in anchors if a in rewrite)
    return preserved / len(anchors) * 100.0


def lexical_retention(original: str, rewrite: str) -> float:
    a = {w for w in words(original) if len(w) > 3}
    b = {w for w in words(rewrite) if len(w) > 3}
    return 100.0 if not a else len(a & b) / len(a) * 100.0


def deterministic_naturalize(text: str) -> str:
    replacements = [
        (r'\bin order to\b', 'to'), (r'\bdue to the fact that\b', 'because'), (r'\bat this point in time\b', 'now'),
        (r'\ba large number of\b', 'many'), (r'\bhas the ability to\b', 'can'), (r'\bplays a crucial role in\b', 'matters in'),
    ]
    result = text
    for pattern, repl in replacements:
        result = re.sub(pattern, repl, result, flags=re.I)
    result = re.sub(r'(?im)(^|(?<=[.!?])\s+)(Furthermore|Moreover|Additionally|Consequently|Overall|Thus|Hence),\s+', r'\1', result)
    result = re.sub(r'(?im)(^|(?<=[.!?])\s+)It is (important|worth) (to note|noting) that\s+', r'\1', result)
    return result.strip()


async def gemini_generate(system: str, prompt: str, temperature: float = 0.45) -> str:
    if not GEMINI_API_KEY:
        raise RuntimeError('GEMINI_API_KEY is not configured')
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}'
    payload = {
        'system_instruction': {'parts': [{'text': system}]},
        'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
        'generationConfig': {'temperature': temperature, 'maxOutputTokens': 4096},
    }
    async with httpx.AsyncClient(timeout=75.0) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
    candidates = data.get('candidates') or []
    if not candidates:
        raise RuntimeError('Gemini returned no candidate')
    parts = candidates[0].get('content', {}).get('parts', [])
    text = ''.join(part.get('text', '') for part in parts).strip()
    if not text:
        raise RuntimeError('Gemini returned empty text')
    return text


class TextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=30000)


class DetectRequest(TextRequest):
    tmrScore: float | None = None
    chunkStdDev: float | None = None
    minChunkScore: float | None = None
    maxChunkScore: float | None = None


class NaturalizeRequest(TextRequest):
    style: Literal['Auto', 'Student', 'Conversational', 'Natural', 'Academic', 'Professional'] = 'Auto'
    strength: Literal['Minimal', 'Balanced', 'Strong'] = 'Balanced'
    variationMode: Literal['Off', 'Subtle'] = 'Subtle'
    voiceSample: str = Field(default='', max_length=7000)


@app.get('/api/health')
async def health():
    return {'ok': True, 'name': APP_NAME, 'geminiConfigured': bool(GEMINI_API_KEY), 'splitter': 'NLTK Punkt'}


@app.post('/api/profile')
async def get_profile(req: TextRequest):
    return profile(req.text)


@app.post('/api/detect')
async def detect(req: DetectRequest):
    p = profile(req.text)
    pats = scan_patterns(req.text, p)
    cross = stylometry_ai_index(p, pats)
    if req.tmrScore is not None:
        final = max(2.0, min(98.0, req.tmrScore * 0.90 + cross * 0.10))
        spread = (req.maxChunkScore or req.tmrScore) - (req.minChunkScore or req.tmrScore)
        conflicting = abs(req.tmrScore - cross) >= 50 or spread >= 70
        if conflicting:
            confidence = 'Low'
        elif p['words'] >= 180 and p['sentences'] >= 10 and (req.chunkStdDev or 0) <= 20 and abs(final - 50) >= 22:
            confidence = 'High'
        elif p['words'] >= 100 and p['sentences'] >= 6 and (req.chunkStdDev or 0) <= 30 and abs(final - 50) >= 12:
            confidence = 'Medium'
        else:
            confidence = 'Low'
        mode = 'TMR neural primary + Python linguistic cross-check'
    else:
        final = cross
        confidence = 'Low'
        mode = 'Python linguistic fallback only'
    classification = 'Likely AI-generated' if final >= 60 else 'Likely human-written' if final <= 40 else 'Mixed / uncertain'
    reasons = []
    reasons.extend(p['warnings'])
    reasons.extend(pats[:4])
    reasons.append(f"MATTR {p['mattr']:.2f} · MTLD {p['mtld']:.0f}")
    reasons.append(f"{p['formalConnectorHits']} formal connector matches")
    return {
        'score': final,
        'classification': 'Mixed / uncertain' if req.tmrScore is not None and abs(req.tmrScore - cross) >= 50 else classification,
        'confidence': confidence,
        'summary': f"The trained TMR neural score is kept as the primary signal; Python NLP contributes only a 10% cross-check. The linguistic cross-check was {cross:.1f}/100.",
        'mode': mode,
        'components': {'tmr': req.tmrScore, 'linguisticCrosscheck': cross, 'stylometry': cross, 'patternScore': min(95, len(pats) * 8)},
        'uncertainty': 7 if confidence == 'High' else 14 if confidence == 'Medium' else 24,
        'reasons': reasons[:7],
        'profile': p,
        'patterns': pats,
    }


@app.post('/api/naturalize')
async def naturalize(req: NaturalizeRequest):
    original = req.text.strip()
    if len(words(original)) < 35:
        raise HTTPException(status_code=400, detail='Please provide at least 35 words.')
    before = profile(original)
    patterns_before = scan_patterns(original, before)
    anchors = protected_anchors(original)

    if len(patterns_before) <= 2 and before['words'] < 900:
        route = 'light'
    elif len(patterns_before) <= 7 and before['words'] < 1800:
        route = 'standard'
    else:
        route = 'heavy'

    style = req.style
    if style == 'Auto':
        style = 'Student' if before['firstPersonDensity'] > 0.7 else 'Academic' if before['nominalizationDensity'] > 3.5 else 'Natural'

    variation_rule = (
        'After clarity is fixed, allow at most one tiny source-safe rough edge in a passage over 180 words: for example one lower-case sentence start after a paragraph break, a missing optional comma, or a brief continuity pivot such as "Anyway,". Never alter proper nouns, sentence-initial names, acronyms, quotations, numbers, citations, URLs, grammar needed for meaning, or more than one location. Do not add spelling errors.'
        if req.variationMode == 'Subtle' else 'Do not introduce deliberate errors or roughness.'
    )
    voice = f"\nVOICE SAMPLE (match rhythm and ordinary phrasing only; never import its facts):\n{req.voiceSample.strip()}\n" if req.voiceSample.strip() else ''
    anchor_text = '\n'.join(f'- {a}' for a in anchors[:40]) or '- none'

    system = (
        'You are a source-faithful human-style editor. Improve naturalness for a real reader, not for a detector. '
        'Keep every factual claim, number, name, date, citation, URL, direct quotation and technical term unless the source itself repeats it unnecessarily. '
        'Do not invent facts, anecdotes, opinions, citations, examples or personal experiences. Avoid synonym spinning.'
    )
    prompt = f'''Target register: {style}. Edit strength: {req.strength}. Route: {route}.
Detected writing patterns: {', '.join(patterns_before) if patterns_before else 'none strongly flagged'}.
Protected anchors that must survive exactly when present:\n{anchor_text}

Editing priorities:
1. State concrete points directly; cut staged run-ups, fake profundity and repeated summary sentences.
2. Break repetitive sentence openings and overly regular sentence lengths only where syntax permits.
3. Reduce mechanical signposting and stock AI vocabulary; use plain verbs and direct nouns.
4. Keep genre and factual meaning stable.
5. {variation_rule}
{voice}
SOURCE:\n{original}\n\nReturn only the revised passage.'''

    if not GEMINI_API_KEY:
        revised = deterministic_naturalize(original)
        after = profile(revised)
        return {
            'text': revised,
            'passes': 1,
            'beforeDistance': before['humanDistance'],
            'afterDistance': after['humanDistance'],
            'lexicalRetention': lexical_retention(original, revised),
            'meaningCheck': 'Local fallback; no generative model configured',
            'anchorPreservation': anchor_preservation(original, revised),
            'voiceMatched': False,
            'variationMode': req.variationMode,
            'microImperfections': [],
            'critique': 'Gemini is not configured, so only conservative deterministic edits were applied.',
            'changes': ['reduced a small set of mechanical phrases'],
            'register': style,
            'strategy': 'deterministic fallback',
            'candidateCount': 1,
            'patternsBefore': patterns_before,
            'patternsAfter': scan_patterns(revised, after),
            'route': route,
        }

    try:
        draft = await gemini_generate(system, prompt, 0.38 if req.strength == 'Minimal' else 0.50)
        passes = 1
        critique = ''
        final = draft

        if route in {'standard', 'heavy'}:
            critique = await gemini_generate(
                'You are a strict copy editor. Identify only remaining artificial writing patterns or source-fidelity risks. Be concise.',
                f'''ORIGINAL:\n{original}\n\nDRAFT:\n{draft}\n\nCheck: factual preservation, protected details, unnecessary AI-style staging, repetitive rhythm, excessive connectors, over-editing, and whether any deliberate rough edge is too distracting. Return a short actionable critique, not a rewrite.''',
                0.1,
            )
            final = await gemini_generate(
                system,
                f'''ORIGINAL:\n{original}\n\nCURRENT DRAFT:\n{draft}\n\nEDITOR CRITIQUE:\n{critique}\n\nApply only fixes justified by the critique. Preserve source meaning and protected details. {variation_rule} Return only the final passage.''',
                0.30,
            )
            passes += 2

        preservation = anchor_preservation(original, final)
        if preservation < 98:
            final = await gemini_generate(
                'Repair a rewrite so all source facts and protected details are preserved exactly. Make no new claims.',
                f'''ORIGINAL:\n{original}\n\nREWRITE:\n{final}\n\nProtected anchors:\n{anchor_text}\n\nRestore missing or altered anchors and any lost source claim while keeping harmless style improvements. Return only repaired text.''',
                0.05,
            )
            passes += 1
            preservation = anchor_preservation(original, final)

        after = profile(final)
        micro = []
        if req.variationMode == 'Subtle' and before['words'] >= 180:
            # We report the mode, but never pretend a rough edge was inserted if none is evident.
            if re.search(r'\n\s*[a-z]', final): micro.append('one lower-case paragraph/sentence start')
            if re.search(r'(?m)(^|[.!?]\s+)Anyway,', final): micro.append('one brief continuity pivot')
        return {
            'text': final,
            'passes': passes,
            'beforeDistance': before['humanDistance'],
            'afterDistance': after['humanDistance'],
            'lexicalRetention': lexical_retention(original, final),
            'meaningCheck': 'Protected anchors checked; source-faithful repair applied if needed',
            'anchorPreservation': preservation,
            'voiceMatched': bool(req.voiceSample.strip()),
            'variationMode': req.variationMode,
            'microImperfections': micro,
            'critique': critique or 'Light route: no separate critique pass was needed.',
            'changes': ['targeted pattern cleanup', 'sentence/rhythm editing', 'source-detail preservation check'],
            'register': style,
            'strategy': f'{route} route · diagnose → rewrite' + (' → critique → finalize' if route != 'light' else ''),
            'candidateCount': 1,
            'patternsBefore': patterns_before,
            'patternsAfter': scan_patterns(final, after),
            'route': route,
        }
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f'Naturalize model request failed: {exc.response.status_code}') from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Naturalize failed: {exc}') from exc

# Optional single-service deployment: serve the Vite build from FastAPI when present.
from pathlib import Path
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

FRONTEND_DIST = Path(os.getenv('FRONTEND_DIST', '/app/frontend_dist'))
if FRONTEND_DIST.exists():
    assets = FRONTEND_DIST / 'assets'
    if assets.exists():
        app.mount('/assets', StaticFiles(directory=assets), name='assets')

    @app.get('/{full_path:path}', include_in_schema=False)
    async def spa_fallback(full_path: str):
        requested = FRONTEND_DIST / full_path
        if full_path and requested.is_file() and FRONTEND_DIST in requested.resolve().parents:
            return FileResponse(requested)
        index_file = FRONTEND_DIST / 'index.html'
        if index_file.exists():
            return FileResponse(index_file)
        raise HTTPException(status_code=404, detail='Frontend build not found')
