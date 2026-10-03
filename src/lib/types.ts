export type Base = 'A' | 'C' | 'G' | 'T';
export const BASES: Base[] = ['A', 'C', 'G', 'T'];

/**
 * none = answer only acknowledged; correctness = right/wrong + correct key;
 * sequence = that plus the true 13-base sequence under the trace;
 * explain = right/wrong + the neighbouring bases + the expected trace for the true base vs the alternative.
 */
export type FeedbackMode = 'none' | 'correctness' | 'sequence' | 'explain';

export interface PhaseSpec {
  name: string;          // id used in the data, e.g. 'pretest'
  label: string;         // shown to the participant / in charts
  trials: number;        // maximum length of this part
  sample: 'DM' | 'MSssI';
  feedback: FeedbackMode;
  feedbackMs: number;
  /** Shown before the part starts (Space to continue). Empty = no intro screen. */
  intro: string;
  /** Optionally end the part early once rolling accuracy reaches a threshold. */
  endOnCriterion?: { minTrials: number; threshold: number; window: number };
  /** Two-choice parts: only these bases are shown and only their keys work. Default: all four. */
  choices?: Base[];
  /** easyFirst = start with traces the CNN finds easiest and move towards harder ones. */
  order?: 'random' | 'easyFirst';
  /** extended = highlight also covers the stretch just after the base (fixed width). */
  band?: 'centre' | 'extended';
}

export interface Config {
  protocol: string;
  /** Physical key for A, C, G, T (in that order). */
  keys: string[];
  itiMs: number;
  phases: PhaseSpec[];
  /** In methylated parts, share of C trials whose centre C is methylated (CpG). */
  mCFraction: number;
  maxDurationMin: number;
  hudWindow: number;
  repsPerBlock: number;
  /** Never show windows seen in earlier sessions on this machine. */
  excludeSeen: boolean;
}

export const PRESETS: Record<string, { title: string; description: string; phases: PhaseSpec[] }> = {
  pretrained: {
    title: 'Session 2 — context training',
    description: 'For someone who has already done session 1: retention test, training with the sequence revealed, transfer test, then methylated DNA.',
    phases: [
      { name: 'pretest', label: 'Pre-test', trials: 64, sample: 'DM', feedback: 'none', feedbackMs: 250,
        intro: 'Part 1 of 4 — warm-up test.\nSame task as before, but no feedback: just give your best answer.' },
      { name: 'training', label: 'Training (sequence shown)', trials: 320, sample: 'DM', feedback: 'sequence', feedbackMs: 2200,
        intro: 'Part 2 of 4 — training.\nAfter each answer you\'ll see the true DNA sequence laid under the trace.\nUse it to learn how neighbouring bases shape the signal.' },
      { name: 'posttest', label: 'Post-test', trials: 64, sample: 'DM', feedback: 'none', feedbackMs: 250,
        intro: 'Part 3 of 4 — test.\nNo feedback again: best answer each time.' },
      { name: 'methylated', label: 'Methylated DNA', trials: 192, sample: 'MSssI', feedback: 'correctness', feedbackMs: 600,
        intro: 'Part 4 of 4.\nFeedback is back (right/wrong only). Keep going.' },
    ],
  },
  session3: {
    title: 'Session 3 — one cue at a time',
    description: 'Pre-test, then C-vs-G and A-vs-G as two-choice tasks (easiest traces first), then all four mixed, with feedback showing the neighbouring bases and the expected trace for the right answer vs the alternative. Post-test at the end.',
    phases: [
      { name: 'pretest', label: 'Pre-test', trials: 64, sample: 'DM', feedback: 'none', feedbackMs: 250, band: 'extended',
        intro: 'Part 1 of 5 — warm-up test.\nNo feedback: just give your best answer.\nThe highlight now also covers the stretch just after the base — that part carries information too.' },
      { name: 'cg', label: 'C vs G', trials: 160, sample: 'DM', feedback: 'explain', feedbackMs: 2200, choices: ['C', 'G'], order: 'easyFirst', band: 'extended',
        intro: 'Part 2 of 5 — C or G?\nOnly C and G traces, only the C and G keys. Easy ones first.\nAfter each answer: the neighbouring bases, and the trace you\'d expect for C (vs G) in exactly this context.' },
      { name: 'ag', label: 'A vs G', trials: 96, sample: 'DM', feedback: 'explain', feedbackMs: 2200, choices: ['A', 'G'], order: 'easyFirst', band: 'extended',
        intro: 'Part 3 of 5 — A or G?\nSame idea: only A and G, easy ones first.' },
      { name: 'mixed', label: 'All four', trials: 192, sample: 'DM', feedback: 'explain', feedbackMs: 2000, band: 'extended',
        intro: 'Part 4 of 5 — all four bases again.\nSame feedback. Use the cues from the last two parts.' },
      { name: 'posttest', label: 'Post-test', trials: 64, sample: 'DM', feedback: 'none', feedbackMs: 250, band: 'extended',
        intro: 'Part 5 of 5 — final test.\nNo feedback: best answer each time.' },
    ],
  },
  first: {
    title: 'Session 1 — learn, then methylation',
    description: 'Learn from right/wrong feedback alone. After you reach 50% (over 100 trials, after at least 300) — or at trial 600 — traces switch to methylated DNA for 200 trials.',
    phases: [
      { name: 'learning', label: 'Learning', trials: 600, sample: 'DM', feedback: 'correctness', feedbackMs: 600, intro: '',
        endOnCriterion: { minTrials: 300, threshold: 0.5, window: 100 } },
      { name: 'methylated', label: 'Methylated DNA', trials: 200, sample: 'MSssI', feedback: 'correctness', feedbackMs: 600, intro: '' },
    ],
  },
};

export const DEFAULT_CONFIG: Config = {
  protocol: 'session3',
  keys: ['A', 'C', 'G', 'T'],
  itiMs: 400,
  phases: PRESETS.session3.phases,
  mCFraction: 0.75,
  maxDurationMin: 45,
  hudWindow: 50,
  repsPerBlock: 8,
  excludeSeen: true,
};

/** One signal window from the dataset. */
export interface Win {
  id: number;
  sample: 'DM' | 'MSssI';
  label: Base;
  context: string;
  signal: Float32Array;
  cs: number;
  ce: number;
  centreMC: boolean;
  nMCContext: number;
  /** Start of each of the 13 context bases (+ end of the last), in samples within the window. */
  bounds: number[];
  preds: Record<string, string>;
  /** Each ML model's preference order over the four bases (for scoring two-choice trials). */
  ranks: Record<string, string>;
  /** CNN probability of the true base, 0–100 (higher = easier). */
  easy: number;
}

export interface KmerTable { before: number; after: number; mean: number; levels: Record<string, number> }

export interface ModelInfo { name: string; label: string; kind: 'simple' | 'deep' | 'sota'; description: string }

export interface Dataset {
  version: string;
  source: Record<string, string>;
  models: ModelInfo[];
  modelAccuracy: Record<string, Record<string, number>>;
  dataEfficiency: { n: number[]; [model: string]: number[] };
  kmer: KmerTable | null;
  windows: Win[];
}

export interface TrialRecord {
  trial: number;
  timestamp: string;
  elapsed_ms: number;
  /** Phase name ('learning' / 'methylated' in session-1 data; protocol part names in later sessions). */
  phase: string;
  feedback?: FeedbackMode;
  /** Bases offered on this trial (two-choice parts), e.g. 'CG'. Absent = all four. */
  choices?: string;
  easiness?: number;
  block: number;
  window_id: number;
  sample: string;
  label: Base;
  pressed: Base;
  pressed_key: string;
  correct: boolean;
  rt_ms: number;
  centre_mC: boolean;
  n_mC_context: number;
  dwell_samples: number;
  rolling_accuracy: number | null;
  onset_perf_ms: number;
  response_perf_ms: number;
}

export interface PriorExperience { sessions: number; trials: number; session_ids: string[]; excluded_windows: number }

export interface SessionMeta {
  app: string;
  app_version: string;
  session_id: string;
  seed: number;
  simulated: boolean;
  config: Config;
  dataset_version: string;
  /** Trial number at which each part started. */
  phase_starts?: Record<string, number>;
  prior?: PriorExperience;
  /** Session-1 format: the criterion-driven switch to methylated DNA. */
  twist?: { first_methylated_trial: number; after_trial: number; reason: string; rolling_accuracy: number | null; timestamp: string; elapsed_ms: number } | null;
  start_time: string;
  end_time: string | null;
  end_reason: string | null;
  total_trials: number;
  active_duration_ms: number;
  paused_ms: number;
  environment: { user_agent: string; estimated_frame_ms: number | null; screen: string };
  timing_notes: string;
}

export interface Session { meta: SessionMeta; trials: TrialRecord[] }
