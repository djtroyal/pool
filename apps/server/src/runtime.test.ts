import { describe, expect, it } from 'vitest';
import { originAllowed, requestAddress, runtimeConfig, SlidingWindowRateLimiter } from './runtime.js';

describe('production runtime safeguards', () => {
  it('accepts the configured origin and gates quick-tunnel origins explicitly', () => {
    const strict = { clientOrigin: 'https://pool.example.com', allowTryCloudflareOrigin: false };
    expect(originAllowed('https://pool.example.com', strict)).toBe(true);
    expect(originAllowed('https://quiet-lake.trycloudflare.com', strict)).toBe(false);
    expect(originAllowed('https://quiet-lake.trycloudflare.com', { ...strict, allowTryCloudflareOrigin: true })).toBe(true);
    expect(originAllowed('http://quiet-lake.trycloudflare.com', { ...strict, allowTryCloudflareOrigin: true })).toBe(false);
    expect(originAllowed('https://trycloudflare.com.evil.test', { ...strict, allowTryCloudflareOrigin: true })).toBe(false);
  });

  it('trusts a valid Cloudflare address only when configured to do so', () => {
    expect(requestAddress({ 'cf-connecting-ip': '203.0.113.8' }, '172.18.0.3', true)).toBe('203.0.113.8');
    expect(requestAddress({ 'cf-connecting-ip': 'not-an-ip' }, '172.18.0.3', true)).toBe('172.18.0.3');
    expect(requestAddress({ 'cf-connecting-ip': '203.0.113.8' }, '172.18.0.3', false)).toBe('172.18.0.3');
  });

  it('enforces an exact sliding-window budget', () => {
    const limiter = new SlidingWindowRateLimiter();
    expect(limiter.allow('profile:create:user', 2, 1_000, 1_000)).toBe(true);
    expect(limiter.allow('profile:create:user', 2, 1_000, 1_100)).toBe(true);
    expect(limiter.allow('profile:create:user', 2, 1_000, 1_200)).toBe(false);
    expect(limiter.allow('profile:create:user', 2, 1_000, 2_001)).toBe(true);
  });

  it('does not expire long-window budgets while pruning short-window keys', () => {
    const limiter = new SlidingWindowRateLimiter(2);
    expect(limiter.allow('long', 1, 60_000, 1_000)).toBe(true);
    expect(limiter.allow('short', 1, 100, 1_000)).toBe(true);
    expect(limiter.allow('replacement', 1, 100, 2_000)).toBe(true);
    expect(limiter.allow('long', 1, 60_000, 2_001)).toBe(false);
  });

  it('validates runtime configuration', () => {
    expect(runtimeConfig({ PORT: '3001', ALLOW_TRYCLOUDFLARE_ORIGIN: 'true' })).toMatchObject({
      port: 3001,
      allowTryCloudflareOrigin: true,
      trustCloudflareIp: false,
      rateLimitsEnabled: false,
      appVersion: 'development'
    });
    expect(runtimeConfig({ NODE_ENV: 'production' }).rateLimitsEnabled).toBe(true);
    expect(runtimeConfig({ NODE_ENV: 'production', RATE_LIMITS_ENABLED: 'false' }).rateLimitsEnabled).toBe(false);
    expect(() => runtimeConfig({ PORT: '0' })).toThrow(/PORT/);
  });
});
