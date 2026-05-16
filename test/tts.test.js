import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTtsProviderName } from '../src/tts.js';

test('resolveTtsProviderName accepts UI provider values', () => {
  assert.equal(resolveTtsProviderName('milora'), 'milora');
  assert.equal(resolveTtsProviderName('mambo'), 'milora');
  assert.equal(resolveTtsProviderName('xfyun'), 'xfyun');
  assert.equal(resolveTtsProviderName('none'), 'none');
});
