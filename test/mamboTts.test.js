import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMamboConfig,
  buildMamboRequestUrl,
  MamboTtsProvider
} from '../src/mamboTts.js';

test('buildMamboConfig reads defaults', () => {
  const config = buildMamboConfig({});

  assert.equal(config.endpoint, 'https://api.milorapart.top/apis/mbAIscvip');
  assert.equal(config.apiKey, '');
  assert.equal(config.apiKeyParam, 'key');
  assert.equal(config.authMode, 'query');
  assert.equal(config.authHeader, 'Authorization');
  assert.equal(config.timeoutMs, 120000);
});

test('buildMamboRequestUrl includes encoded text and api key parameters', () => {
  const url = new URL(
    buildMamboRequestUrl('mambo voice 123', {
      endpoint: 'https://api.milorapart.top/apis/mbAIscvip',
      apiKey: 'test-key',
      apiKeyParam: 'key',
      authMode: 'query',
      timeoutMs: 120000
    })
  );

  assert.equal(url.hostname, 'api.milorapart.top');
  assert.equal(url.pathname, '/apis/mbAIscvip');
  assert.equal(url.searchParams.get('text'), 'mambo voice 123');
  assert.equal(url.searchParams.get('key'), 'test-key');
});

test('buildMamboRequestUrl omits api key from query outside query auth mode', () => {
  const url = new URL(
    buildMamboRequestUrl('mambo voice 123', {
      endpoint: 'https://api.milorapart.top/apis/mbAIscvip',
      apiKey: 'test-key',
      apiKeyParam: 'key',
      authMode: 'bearer',
      timeoutMs: 120000
    })
  );

  assert.equal(url.searchParams.get('text'), 'mambo voice 123');
  assert.equal(url.searchParams.get('key'), null);
});

test('MamboTtsProvider rejects missing api key', () => {
  assert.throws(
    () => new MamboTtsProvider({ ...buildMamboConfig({}), apiKey: '' }),
    /API Key/
  );
});
