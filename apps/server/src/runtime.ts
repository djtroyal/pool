import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

export interface RuntimeConfig {
  port: number;
  clientOrigin: string;
  allowTryCloudflareOrigin: boolean;
  trustCloudflareIp: boolean;
  rateLimitsEnabled: boolean;
  appVersion: string;
}

function enabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

export function runtimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const port = Number(environment.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new TypeError('PORT must be an integer from 1 to 65535.');
  return {
    port,
    clientOrigin: environment.CLIENT_ORIGIN ?? 'http://127.0.0.1:5173',
    allowTryCloudflareOrigin: enabled(environment.ALLOW_TRYCLOUDFLARE_ORIGIN),
    trustCloudflareIp: enabled(environment.TRUST_CLOUDFLARE_IP),
    rateLimitsEnabled: environment.RATE_LIMITS_ENABLED === undefined
      ? environment.NODE_ENV === 'production'
      : enabled(environment.RATE_LIMITS_ENABLED),
    appVersion: environment.APP_VERSION?.trim() || 'development'
  };
}

export function originAllowed(origin: string | undefined, config: Pick<RuntimeConfig, 'clientOrigin' | 'allowTryCloudflareOrigin'>): boolean {
  if (!origin) return true;
  if (origin === config.clientOrigin) return true;
  if (!config.allowTryCloudflareOrigin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'https:'
      && parsed.port === ''
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.trycloudflare\.com$/i.test(parsed.hostname)
      && parsed.pathname === '/';
  } catch {
    return false;
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(',')[0]?.trim();
}

export function requestAddress(
  headers: Record<string, string | string[] | undefined>,
  fallbackAddress: string,
  trustCloudflareIp: boolean
): string {
  if (trustCloudflareIp) {
    const candidate = firstHeader(headers['cf-connecting-ip']);
    if (candidate && isIP(candidate)) return candidate;
  }
  return fallbackAddress;
}

export class SlidingWindowRateLimiter {
  private readonly events = new Map<string, { times: number[]; expiresAt: number }>();
  private readonly salt = randomBytes(16);

  constructor(private readonly maximumKeys = 10_000) {}

  identity(address: string): string {
    return createHash('sha256').update(this.salt).update(address).digest('base64url');
  }

  allow(key: string, maximum: number, windowMs: number, now = Date.now()): boolean {
    if (!this.events.has(key) && this.events.size >= this.maximumKeys) {
      this.sweep(now);
      if (this.events.size >= this.maximumKeys) return false;
    }
    const cutoff = now - windowMs;
    const recent = (this.events.get(key)?.times ?? []).filter((time) => time > cutoff);
    if (recent.length >= maximum) {
      this.events.set(key, { times: recent, expiresAt: now + windowMs });
      return false;
    }
    recent.push(now);
    this.events.set(key, { times: recent, expiresAt: now + windowMs });
    return true;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.events) {
      if (entry.expiresAt <= now) this.events.delete(key);
    }
  }
}
