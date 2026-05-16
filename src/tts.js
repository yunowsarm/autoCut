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
  const raw = String(env.TTS_PROVIDER || 'milora').toLowerCase();
  if (raw === 'none') return 'none';
  if (raw === 'xfyun') return 'xfyun';
  if (MILORA_PROVIDER_ALIASES.has(raw)) return 'milora';
  return raw;
}

export async function createDefaultTtsProvider() {
  loadEnv();
  const providerName = resolveTtsProviderName();

  if (providerName === 'none') {
    return new TtsProvider();
  }

  if (providerName === 'xfyun') {
    const { XfyunLongTextTtsProvider } = await import('./xfyunTts.js');
    return new XfyunLongTextTtsProvider();
  }

  if (providerName === 'milora') {
    const { MiloraTtsProvider } = await import('./mamboTts.js');
    return new MiloraTtsProvider();
  }

  throw new Error(
    `不支持的 TTS_PROVIDER：${process.env.TTS_PROVIDER}。可选：milora、xfyun、none`,
  );
}

export async function createXfyunTtsProvider() {
  const { XfyunLongTextTtsProvider } = await import('./xfyunTts.js');
  return new XfyunLongTextTtsProvider();
}
