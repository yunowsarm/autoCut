import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthUrl, buildXfyunConfig } from '../src/xfyunTts.js';

test('buildXfyunConfig reads defaults without secrets in code', () => {
  const config = buildXfyunConfig({
    XFYUN_APP_ID: 'appid',
    XFYUN_API_KEY: 'key',
    XFYUN_API_SECRET: 'secret'
  });

  assert.equal(config.appId, 'appid');
  assert.equal(config.apiKey, 'key');
  assert.equal(config.apiSecret, 'secret');
  assert.equal(config.vcn, 'x4_mingge');
  assert.equal(config.speed, 50);
});

test('buildAuthUrl includes signed query fields', () => {
  const url = new URL(
    buildAuthUrl(
      '/v1/private/dts_create',
      {
        apiKey: 'key',
        apiSecret: 'secret'
      },
      new Date('2026-05-15T00:00:00Z')
    )
  );

  assert.equal(url.hostname, 'api-dx.xf-yun.com');
  assert.equal(url.pathname, '/v1/private/dts_create');
  assert.equal(url.searchParams.get('host'), 'api-dx.xf-yun.com');
  assert.equal(url.searchParams.get('date'), 'Fri, 15 May 2026 00:00:00 GMT');
  assert.ok(url.searchParams.get('authorization'));
});
