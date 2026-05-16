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

export async function createDefaultTtsProvider() {
  loadEnv();

  if (process.env.TTS_PROVIDER === 'none') {
    return new TtsProvider();
  }

  const { XfyunLongTextTtsProvider } = await import('./xfyunTts.js');
  return new XfyunLongTextTtsProvider();
}
