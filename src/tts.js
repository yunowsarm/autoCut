import { loadEnv } from './env.js';

export class TtsProvider {
  async generateNarration() {
    return null;
  }
}

export class NarrationTrack {
  constructor({ filePath = null, duration = 0, segments = [] } = {}) {
    this.filePath = filePath;
    this.duration = duration;
    this.segments = segments;
  }
}

export async function generateNarration(segments, settings, provider = new TtsProvider()) {
  return provider.generateNarration(segments, settings);
}

const MILORA_PROVIDER_ALIASES = new Set([
  'mambo',
  'milora',
  'mbAIscvip',
  'milorapart',
]);

export function resolveTtsProviderName(env = process.env) {
  const rawValue = typeof env === 'string' ? env : env.TTS_PROVIDER;
  const raw = String(rawValue || 'milora').toLowerCase();
  if (raw === 'none') return 'none';
  if (raw === 'xfyun') return 'xfyun';
  if (MILORA_PROVIDER_ALIASES.has(raw)) return 'milora';
  return raw;
}

export async function createTtsProvider(providerName) {
  loadEnv();
  const resolvedProviderName = resolveTtsProviderName(providerName || process.env.TTS_PROVIDER);

  if (resolvedProviderName === 'none') {
    return new TtsProvider();
  }

  if (resolvedProviderName === 'xfyun') {
    const { XfyunLongTextTtsProvider } = await import('./xfyunTts.js');
    return new XfyunLongTextTtsProvider();
  }

  if (resolvedProviderName === 'milora') {
    const { MiloraTtsProvider } = await import('./mamboTts.js');
    return new MiloraTtsProvider();
  }

  throw new Error(
    `不支持的 TTS_PROVIDER：${process.env.TTS_PROVIDER}。可选：milora、xfyun、none`,
  );
}

export async function createDefaultTtsProvider() {
  return createTtsProvider();
}

export async function createXfyunTtsProvider() {
  const { XfyunLongTextTtsProvider } = await import('./xfyunTts.js');
  return new XfyunLongTextTtsProvider();
}
