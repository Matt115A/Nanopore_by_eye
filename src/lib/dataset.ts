import type { Base, Dataset, KmerTable, ModelInfo, Win } from './types';

/** Signals are stored as int8: value / QUANT = normalised current. */
export const QUANT = 20;

interface RawDataset {
  version: string;
  source: Record<string, string>;
  models: ModelInfo[];
  model_accuracy: Record<string, Record<string, number>>;
  data_efficiency: { n: number[]; [k: string]: number[] };
  model_order: string[];
  rank_models?: string[];
  kmer?: KmerTable;
  windows: { id: number; s: 'DM' | 'MSssI'; l: Base; ctx: string; o: number; n: number; cs: number; ce: number; mc: number; nmc: number; p: string; b?: number[]; r?: string; e?: number }[];
}

export async function loadDataset(base = `${import.meta.env.BASE_URL}data/`): Promise<Dataset> {
  const [meta, bin] = await Promise.all([
    fetch(base + 'dataset.json').then((r) => r.json() as Promise<RawDataset>),
    fetch(base + 'dataset.bin').then((r) => r.arrayBuffer()),
  ]);
  return parseDataset(meta, new Int8Array(bin));
}

export function parseDataset(meta: RawDataset, bytes: Int8Array): Dataset {
  const windows: Win[] = meta.windows.map((w) => {
    const signal = new Float32Array(w.n);
    for (let i = 0; i < w.n; i++) signal[i] = bytes[w.o + i] / QUANT;
    const preds: Record<string, string> = {};
    meta.model_order.forEach((m, i) => (preds[m] = w.p[i]));
    const ranks: Record<string, string> = {};
    (meta.rank_models ?? []).forEach((m, i) => (ranks[m] = (w.r ?? '').slice(4 * i, 4 * i + 4)));
    return { id: w.id, sample: w.s, label: w.l, context: w.ctx, signal, cs: w.cs, ce: w.ce, centreMC: !!w.mc, nMCContext: w.nmc, bounds: w.b ?? [], preds, ranks, easy: w.e ?? 50 };
  });
  return { version: meta.version, source: meta.source, models: meta.models, modelAccuracy: meta.model_accuracy, dataEfficiency: meta.data_efficiency, kmer: meta.kmer ?? null, windows };
}

/** Same fixed-length representation the Python models use: window resampled to 128 points + centre mask. */
export function features(w: Win, n = 128): Float32Array {
  const out = new Float32Array(2 * n);
  const L = w.signal.length;
  for (let i = 0; i < n; i++) {
    const x = (i * (L - 1)) / (n - 1), k = Math.floor(x), f = x - k;
    out[i] = k + 1 < L ? w.signal[k] * (1 - f) + w.signal[k + 1] * f : w.signal[L - 1];
    const mx = Math.round(x);
    out[n + i] = mx >= w.cs && mx < w.ce ? 1 : 0;
  }
  return out;
}

/** Centre-segment level features (mean, sd, duration) — the "eyeball" summary. */
export function levelFeatures(w: Win): [number, number, number] {
  let s = 0, ss = 0;
  const n = w.ce - w.cs;
  for (let i = w.cs; i < w.ce; i++) { s += w.signal[i]; ss += w.signal[i] ** 2; }
  const m = s / n;
  return [m, Math.sqrt(Math.max(0, ss / n - m * m)), n];
}

/** Expected current for each of the 13 context bases (NaN where the 5-mer runs off the window's context). */
export function expectedLevels(ctx: string, k: KmerTable): number[] {
  return Array.from({ length: ctx.length }, (_, i) => {
    if (i - k.before < 0 || i + k.after >= ctx.length) return NaN;
    return k.levels[ctx.slice(i - k.before, i + k.after + 1)] ?? k.mean;
  });
}
