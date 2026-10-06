import { pipeline } from '@huggingface/transformers';
import { sentenceList, wordList } from './textAnalysis';

const MODEL_ID = 'onnx-community/tmr-ai-text-detector-ONNX';

type TextClassifier = (input: string, options?: Record<string, unknown>) => Promise<unknown>;
type Prediction = { label: string; score: number };

export type TmrDetection = {
  score: number;
  weightedMean: number;
  medianScore: number;
  chunks: number;
  model: string;
  minChunkScore: number;
  maxChunkScore: number;
  chunkStdDev: number;
};

let classifierPromise: Promise<TextClassifier> | null = null;

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

function makeChunks(text: string) {
  const sentences = sentenceList(text);
  if (!sentences.length) return [text.slice(0, 4000)];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const sentence of sentences) {
    const count = wordList(sentence).length;
    if (current.length && currentWords + count > 240 && currentWords >= 120) {
      chunks.push(current.join(' '));
      current = [];
      currentWords = 0;
    }
    current.push(sentence);
    currentWords += count;
  }
  if (current.length) chunks.push(current.join(' '));

  if (chunks.length <= 10) return chunks;
  const sampled: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const index = Math.round((i * (chunks.length - 1)) / 9);
    sampled.push(chunks[index]);
  }
  return sampled;
}

function isPrediction(value: unknown): value is Prediction {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { label?: unknown; score?: unknown };
  return typeof candidate.label === 'string' && typeof candidate.score === 'number';
}

function flattenPredictions(output: unknown): Prediction[] {
  if (isPrediction(output)) return [output];
  if (!Array.isArray(output)) return [];
  const flat: Prediction[] = [];
  for (const item of output) {
    if (isPrediction(item)) flat.push(item);
    else if (Array.isArray(item)) {
      for (const nested of item) if (isPrediction(nested)) flat.push(nested);
    }
  }
  return flat;
}

function normalizedLabel(label: string) {
  return label.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function aiProbability(output: unknown): number {
  const predictions = flattenPredictions(output);
  if (!predictions.length) throw new Error('Unexpected TMR classifier output');

  const ai = predictions.find((item) => {
    const label = normalizedLabel(item.label);
    return label === 'ai' || label === 'label_1' || label === '1' || label.includes('generated');
  });
  if (ai) return Math.max(0, Math.min(1, ai.score));

  const human = predictions.find((item) => {
    const label = normalizedLabel(item.label);
    return label === 'human' || label === 'label_0' || label === '0';
  });
  if (human) return Math.max(0, Math.min(1, 1 - human.score));

  if (predictions.length === 2) {
    const byLabel = [...predictions].sort((a, b) => normalizedLabel(a.label).localeCompare(normalizedLabel(b.label)));
    return Math.max(0, Math.min(1, byLabel[1].score));
  }

  throw new Error(`TMR labels were not recognized: ${predictions.map((item) => item.label).join(', ')}`);
}

async function getClassifier(): Promise<TextClassifier> {
  if (!classifierPromise) {
    const loading = pipeline('text-classification', MODEL_ID, { dtype: 'q8' })
      .then((loaded: unknown) => loaded as TextClassifier)
      .catch((error: unknown) => {
        classifierPromise = null;
        throw error;
      });
    classifierPromise = loading;
  }
  return classifierPromise as Promise<TextClassifier>;
}

export async function detectWithTmr(text: string): Promise<TmrDetection> {
  const classifier = await getClassifier();
  const chunks = makeChunks(text);
  const scores: { score: number; weight: number }[] = [];

  for (const chunk of chunks) {
    const output = await classifier(chunk, { truncation: true, top_k: null });
    scores.push({ score: aiProbability(output), weight: Math.max(1, wordList(chunk).length) });
  }

  const totalWeight = scores.reduce((sum, item) => sum + item.weight, 0);
  const weighted = scores.reduce((sum, item) => sum + item.score * item.weight, 0) / Math.max(1, totalWeight);
  const values = scores.map((item) => item.score * 100);
  const medianValue = median(values);
  const robustScore = weighted * 100 * 0.72 + medianValue * 0.28;

  return {
    score: Math.max(0, Math.min(100, robustScore)),
    weightedMean: weighted * 100,
    medianScore: medianValue,
    chunks: chunks.length,
    model: MODEL_ID,
    minChunkScore: Math.min(...values),
    maxChunkScore: Math.max(...values),
    chunkStdDev: stdev(values),
  };
}
