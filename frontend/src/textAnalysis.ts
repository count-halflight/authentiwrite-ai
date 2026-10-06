export type Profile = {
  words: number;
  sentences: number;
  avgSentence: number;
  medianSentence: number;
  sentenceCv: number;
  mattr: number;
  mtld: number;
  lexicalIndex: number;
  hapaxRatio: number;
  punctuationDensity: number;
  punctuationCv: number;
  formalConnectorDensity: number;
  formalConnectorHits: number;
  formalConnectorPhrases: string[];
  contractionDensity: number;
  questionRate: number;
  firstPersonDensity: number;
  nominalizationDensity: number;
  repetitionRate: number;
  commaDensity: number;
  humanDistance: number;
  microIrregularity: number;
  sentenceLengths: number[];
  sentenceTexts: string[];
  lexicalReliability: 'Low' | 'Medium' | 'High';
};

export type ReferenceMetric = {
  key: keyof Profile;
  label: string;
  low: number;
  high: number;
  unit: string;
  decimals?: number;
};

export const REFERENCE_PROFILE: ReferenceMetric[] = [
  { key: 'avgSentence', label: 'Average sentence length', low: 10, high: 28, unit: ' words', decimals: 1 },
  { key: 'sentenceCv', label: 'Sentence-length variation', low: 0.35, high: 0.85, unit: '', decimals: 2 },
  { key: 'mattr', label: 'MATTR lexical diversity', low: 0.55, high: 0.82, unit: '', decimals: 2 },
  { key: 'mtld', label: 'MTLD lexical diversity', low: 45, high: 120, unit: '', decimals: 0 },
  { key: 'punctuationCv', label: 'Punctuation-interval variation', low: 0.38, high: 1.25, unit: '', decimals: 2 },
  { key: 'formalConnectorDensity', label: 'Formal connectors', low: 0, high: 1.8, unit: '/100w', decimals: 2 },
  { key: 'repetitionRate', label: 'Repeated bigrams', low: 0, high: 1.8, unit: '%', decimals: 2 },
];

const SENTINEL = '∯';
const TITLE_ABBREVIATIONS = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Rev', 'Sr', 'Jr', 'St', 'Capt', 'Cmdr', 'Gen', 'Lt', 'Sgt'];
const ALWAYS_ABBREVIATIONS = ['e.g', 'i.e', 'a.m', 'p.m', 'Ph.D', 'M.D', 'B.Sc', 'M.Sc', 'vs', 'cf'];
const COMMON_ABBREVIATIONS = [
  'etc', 'al', 'approx', 'dept', 'est', 'fig', 'figs', 'no', 'nos', 'sec', 'secs', 'vol', 'vols',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
];

export const FORMAL_CONNECTORS = [
  'it is important to note', 'it is worth noting', 'on the other hand', 'as a consequence', 'as a result', 'for this reason',
  'in light of this', 'in view of this', 'in addition to this', 'in addition', 'in contrast', 'by contrast', 'despite this',
  'in comparison', 'in the same way', 'at the same time', 'to illustrate', 'for example', 'for instance', 'in particular',
  'more specifically', 'more importantly', 'with regard to', 'with respect to', 'in relation to', 'in conclusion', 'to conclude',
  'in summary', 'to summarize', 'taken together', 'all in all', 'on balance', 'first of all', 'to begin with', 'in the first place',
  'in the second place', 'at this point', 'in other words', 'that is to say', 'because of this', 'due to this', 'owing to this',
  'notwithstanding this', 'even so', 'nevertheless', 'nonetheless', 'however', 'moreover', 'furthermore', 'additionally',
  'consequently', 'therefore', 'accordingly', 'subsequently', 'similarly', 'likewise', 'meanwhile', 'ultimately', 'overall',
  'indeed', 'notably', 'significantly', 'specifically', 'thus', 'hence', 'finally', 'firstly', 'secondly', 'thirdly',
];

export function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function wordList(text: string) {
  return (text.normalize('NFKC').toLowerCase().replace(/[’]/g, "'").match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || []);
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stdev(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function protectPeriods(value: string) {
  return value.replace(/\./g, SENTINEL);
}

function protectAbbreviations(text: string) {
  let protectedText = text;

  protectedText = protectedText.replace(/\b\d+\.\d+\b/g, (match) => protectPeriods(match));
  protectedText = protectedText.replace(/\b(?:https?:\/\/|www\.)\S+/gi, (match) => protectPeriods(match));
  protectedText = protectedText.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, (match) => protectPeriods(match));
  protectedText = protectedText.replace(/\b(?:[A-Z]\.){2,}(?=\s|$)/g, (match) => protectPeriods(match));
  protectedText = protectedText.replace(/\b[A-Z]\.\s*(?=[A-Z]\.?(?:\s|$))/g, (match) => protectPeriods(match));
  protectedText = protectedText.replace(/\b[A-Z]\.\s+(?=[A-Z][a-z]{2,}\b)/g, (match) => protectPeriods(match));

  const titles = new RegExp(`\\b(?:${TITLE_ABBREVIATIONS.map(escapeRegExp).join('|')})\\.(?=\\s+[A-Z])`, 'g');
  protectedText = protectedText.replace(titles, (match) => protectPeriods(match));

  for (const abbreviation of ALWAYS_ABBREVIATIONS) {
    const pattern = new RegExp(`\\b${escapeRegExp(abbreviation)}\\.(?=\\s+\\S)`, 'gi');
    protectedText = protectedText.replace(pattern, (match) => protectPeriods(match));
  }
  for (const abbreviation of COMMON_ABBREVIATIONS) {
    const pattern = new RegExp(`\\b${escapeRegExp(abbreviation)}\\.(?=\\s+[a-z0-9(])`, 'g');
    protectedText = protectedText.replace(pattern, (match) => protectPeriods(match));
  }

  return protectedText;
}

export function sentenceList(text: string) {
  const normalized = text
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!normalized) return [];

  const protectedText = protectAbbreviations(normalized);
  const paragraphs = protectedText.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  const output: string[] = [];

  for (const paragraph of paragraphs) {
    const marked = paragraph
      .replace(/\n+/g, ' ')
      .replace(/([.!?]+(?:["”’')\]}»]+)?)\s+(?=\S)/g, `$1<AUTHENTIWRITE_SENTENCE_BREAK>`);
    const pieces = marked.split('<AUTHENTIWRITE_SENTENCE_BREAK>').map((item) => item.replaceAll(SENTINEL, '.').trim()).filter(Boolean);
    output.push(...pieces);
  }

  return output;
}

export function movingTypeTokenRatio(tokens: string[], windowSize = 50) {
  if (!tokens.length) return 0;
  const window = Math.min(windowSize, tokens.length);
  if (tokens.length <= window) return new Set(tokens).size / tokens.length;
  let total = 0;
  let windows = 0;
  const step = tokens.length > 3000 ? 5 : 1;
  for (let start = 0; start + window <= tokens.length; start += step) {
    const slice = tokens.slice(start, start + window);
    total += new Set(slice).size / slice.length;
    windows += 1;
  }
  return windows ? total / windows : 0;
}

function mtldDirection(tokens: string[], threshold = 0.72) {
  if (!tokens.length) return 0;
  let factors = 0;
  let tokenCount = 0;
  const types = new Set<string>();
  let lastTtr = 1;
  for (const token of tokens) {
    tokenCount += 1;
    types.add(token);
    lastTtr = types.size / tokenCount;
    if (lastTtr <= threshold) {
      factors += 1;
      tokenCount = 0;
      types.clear();
      lastTtr = 1;
    }
  }
  if (tokenCount > 0) {
    const partial = (1 - lastTtr) / (1 - threshold);
    factors += Math.max(0.01, partial);
  }
  return tokens.length / Math.max(0.01, factors);
}

export function mtld(tokens: string[]) {
  if (tokens.length < 20) return tokens.length ? new Set(tokens).size : 0;
  return mean([mtldDirection(tokens), mtldDirection([...tokens].reverse())]);
}

function rangePenalty(value: number, low: number, high: number, scale: number) {
  if (value >= low && value <= high) return 0;
  const delta = value < low ? low - value : value - high;
  return clamp((delta / scale) * 100);
}

function connectorMatches(text: string) {
  const lower = text.toLowerCase().replace(/[’]/g, "'");
  const occupied: Array<[number, number]> = [];
  const found: { phrase: string; start: number; end: number }[] = [];
  const sorted = [...FORMAL_CONNECTORS].sort((a, b) => b.length - a.length);

  for (const phrase of sorted) {
    const source = escapeRegExp(phrase).replace(/\\ /g, '\\s+');
    const regex = new RegExp(`\\b${source}\\b`, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(lower)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!occupied.some(([a, b]) => start < b && end > a)) {
        occupied.push([start, end]);
        found.push({ phrase, start, end });
      }
      if (regex.lastIndex === match.index) regex.lastIndex += 1;
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export function profile(text: string): Profile {
  const tokens = wordList(text);
  const sentenceTexts = sentenceList(text);
  const sentenceLengths = sentenceTexts.map((sentence) => wordList(sentence).length).filter((length) => length > 0);
  const avgSentence = mean(sentenceLengths);
  const sentenceCv = avgSentence ? stdev(sentenceLengths) / avgSentence : 0;
  const mattr = movingTypeTokenRatio(tokens, 50);
  const mtldValue = mtld(tokens);

  const counts = new Map<string, number>();
  tokens.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  const hapaxRatio = tokens.length ? [...counts.values()].filter((count) => count === 1).length / tokens.length : 0;

  const tokenStream = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|[,.!?;:—()]/gu) || [];
  const pauseIntervals: number[] = [];
  let sincePause = 0;
  let punctuationCount = 0;
  tokenStream.forEach((token) => {
    if (/^[,.!?;:—()]$/.test(token)) {
      punctuationCount += 1;
      if (sincePause > 0) pauseIntervals.push(sincePause);
      sincePause = 0;
    } else {
      sincePause += 1;
    }
  });
  const pauseMean = mean(pauseIntervals);
  const punctuationCv = pauseMean ? stdev(pauseIntervals) / pauseMean : 0;
  const punctuationDensity = tokens.length ? (punctuationCount / tokens.length) * 100 : 0;
  const commaDensity = tokens.length ? ((text.match(/,/g) || []).length / tokens.length) * 100 : 0;

  const connectors = connectorMatches(text);
  const formalConnectorHits = connectors.length;
  const formalConnectorDensity = tokens.length ? (formalConnectorHits / tokens.length) * 100 : 0;
  const formalConnectorPhrases = [...new Set(connectors.map((item) => item.phrase))];
  const contractionDensity = tokens.length ? (tokens.filter((word) => word.includes("'")).length / tokens.length) * 100 : 0;
  const questionRate = sentenceTexts.length ? (sentenceTexts.filter((sentence) => /\?["”’')\]}»]*$/.test(sentence)).length / sentenceTexts.length) * 100 : 0;
  const firstPerson = tokens.filter((word) => ['i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours'].includes(word)).length;
  const firstPersonDensity = tokens.length ? (firstPerson / tokens.length) * 100 : 0;
  const nominalizations = tokens.filter((word) => /(tion|sion|ment|ity|ness|ance|ence)$/.test(word)).length;
  const nominalizationDensity = tokens.length ? (nominalizations / tokens.length) * 100 : 0;
  const bigrams = tokens.slice(0, -1).map((word, index) => `${word} ${tokens[index + 1]}`);
  const repetitionRate = tokens.length ? ((bigrams.length - new Set(bigrams).size) / tokens.length) * 100 : 0;
  const adjacentJumps = sentenceLengths.slice(1).map((length, index) => Math.abs(length - sentenceLengths[index]));
  const jumpRatio = avgSentence ? mean(adjacentJumps) / avgSentence : 0;
  const punctuationKinds = new Set(text.match(/[,.!?;:—()]/g) || []).size;
  const microIrregularity = clamp(jumpRatio * 65 + punctuationCv * 18 + Math.min(8, contractionDensity * 2.5) + Math.min(8, punctuationKinds * 1.1));

  const lexicalReliability: Profile['lexicalReliability'] = tokens.length >= 200 ? 'High' : tokens.length >= 100 ? 'Medium' : 'Low';
  const lexicalIndex = clamp(((mattr - 0.4) / 0.5) * 60 + ((Math.min(mtldValue, 160) - 20) / 140) * 40);
  const lexicalPenalty = tokens.length >= 80
    ? rangePenalty(mattr, 0.55, 0.82, 0.32) * 0.11 + rangePenalty(mtldValue, 45, 120, 75) * 0.07
    : rangePenalty(mattr, 0.50, 0.88, 0.38) * 0.10;

  const humanDistance = clamp(
    rangePenalty(sentenceCv, 0.35, 0.85, 0.5) * 0.24 +
      rangePenalty(punctuationCv, 0.38, 1.25, 0.9) * 0.16 +
      lexicalPenalty +
      rangePenalty(formalConnectorDensity, 0, 1.8, 2.4) * 0.10 +
      rangePenalty(repetitionRate, 0, 1.8, 2.6) * 0.11 +
      rangePenalty(avgSentence, 10, 28, 20) * 0.07,
  );

  return {
    words: tokens.length,
    sentences: sentenceTexts.length,
    avgSentence,
    medianSentence: median(sentenceLengths),
    sentenceCv,
    mattr,
    mtld: mtldValue,
    lexicalIndex,
    hapaxRatio,
    punctuationDensity,
    punctuationCv,
    formalConnectorDensity,
    formalConnectorHits,
    formalConnectorPhrases,
    contractionDensity,
    questionRate,
    firstPersonDensity,
    nominalizationDensity,
    repetitionRate,
    commaDensity,
    humanDistance,
    microIrregularity,
    sentenceLengths,
    sentenceTexts,
    lexicalReliability,
  };
}

export function localStylometryScore(p: Profile) {
  let score = 50;
  if (p.sentences < 4 || p.words < 80) return 50;
  if (p.sentenceCv < 0.25) score += 16;
  else if (p.sentenceCv > 0.48) score -= 6;
  if (p.punctuationCv < 0.28) score += 8;
  else if (p.punctuationCv > 0.55) score -= 3;
  if (p.mattr < 0.50 && p.words >= 100) score += 6;
  else if (p.mattr > 0.64) score -= 3;
  if (p.formalConnectorDensity > 1.8) score += 8;
  if (p.repetitionRate > 1.8) score += 6;
  if (p.avgSentence > 29 && p.commaDensity > 4.5) score += 5;
  if (p.nominalizationDensity > 5.5) score += 4;
  if (p.microIrregularity < 16) score += 4;
  else if (p.microIrregularity > 30) score -= 2;
  return clamp(score, 10, 90);
}

export function reliability(p: Profile) {
  if (p.words >= 180 && p.sentences >= 10) return 'High';
  if (p.words >= 100 && p.sentences >= 6) return 'Medium';
  return 'Low';
}

export function referenceStatus(value: number, low: number, high: number) {
  if (value >= low && value <= high) return 'Within band';
  return value < low ? 'Below band' : 'Above band';
}
