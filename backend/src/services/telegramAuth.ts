import crypto from 'node:crypto';

export interface TelegramInitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  is_premium?: boolean;
}

interface VerifyCacheEntry {
  user: TelegramInitDataUser;
  expiresAt: number;
}

const verifyCache = new Map<string, VerifyCacheEntry>();

const cacheKeyFromInitData = (initData: string): string => {
  return crypto.createHash('sha256').update(initData).digest('hex');
};

const getVerifyCacheTtlMs = (): number => {
  const raw = Number.parseInt(process.env.TELEGRAM_VERIFY_CACHE_TTL_MS ?? '30000', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
};

const getVerifyCacheMaxEntries = (): number => {
  const raw = Number.parseInt(process.env.TELEGRAM_VERIFY_CACHE_MAX_ENTRIES ?? '5000', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 5000;
};

const cleanupVerifyCache = (): void => {
  const now = Date.now();
  for (const [key, entry] of verifyCache.entries()) {
    if (entry.expiresAt <= now) {
      verifyCache.delete(key);
    }
  }

  const maxEntries = getVerifyCacheMaxEntries();
  while (verifyCache.size > maxEntries) {
    const oldestKey = verifyCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    verifyCache.delete(oldestKey);
  }
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  return value === 'true';
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const buildDevMockUserFromEnv = (): TelegramInitDataUser => {
  return {
    id: parseNumber(process.env.DEV_MOCK_USER_ID, 10001),
    username: process.env.DEV_MOCK_USERNAME,
    first_name: process.env.DEV_MOCK_FIRST_NAME ?? 'Dev',
    last_name: process.env.DEV_MOCK_LAST_NAME,
    is_premium: parseBoolean(process.env.DEV_MOCK_IS_PREMIUM, false)
  };
};

const createDataCheckString = (
  params: URLSearchParams,
  options?: { includeSignature?: boolean }
): string => {
  const includeSignature = options?.includeSignature ?? true;

  return [...params.entries()]
    .filter(([key]) => key !== 'hash' && (includeSignature || key !== 'signature'))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
};

const createDataCheckStringFromRaw = (
  initData: string,
  options?: { includeSignature?: boolean }
): string => {
  const includeSignature = options?.includeSignature ?? true;

  const safeDecode = (value: string): string => {
    try {
      return decodeURIComponent(value.replace(/\+/g, '%20'));
    } catch {
      return value;
    }
  };

  return initData
    .split('&')
    .map((part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex < 0) {
        return [part, ''] as const;
      }
      return [part.slice(0, separatorIndex), part.slice(separatorIndex + 1)] as const;
    })
    .filter(([key]) => key !== 'hash' && (includeSignature || key !== 'signature'))
    .map(([key, value]) => {
      const normalizedValue = safeDecode(value);
      return [key, normalizedValue] as const;
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
};

const secureCompareHex = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const parseUser = (serializedUser: string | null): TelegramInitDataUser | null => {
  if (!serializedUser) {
    return null;
  }

  try {
    const parsed = JSON.parse(serializedUser) as Partial<TelegramInitDataUser>;
    if (typeof parsed.id !== 'number' || typeof parsed.first_name !== 'string') {
      return null;
    }

    return {
      id: parsed.id,
      first_name: parsed.first_name,
      last_name: parsed.last_name,
      username: parsed.username,
      photo_url: parsed.photo_url,
      is_premium: parsed.is_premium ?? false
    };
  } catch {
    return null;
  }
};

export const verifyTelegramInitData = (
  initData: string,
  botToken: string
): TelegramInitDataUser | null => {
  cleanupVerifyCache();

  const cacheKey = cacheKeyFromInitData(initData);
  const cached = verifyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const maxAuthAgeSeconds = Number.parseInt(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS ?? '300', 10);
  const authTtl = Number.isFinite(maxAuthAgeSeconds) && maxAuthAgeSeconds > 0 ? maxAuthAgeSeconds : 300;

  const safeDecode = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const variants = Array.from(
    new Set([
      initData,
      safeDecode(initData),
      initData.replace(/ /g, '+'),
      safeDecode(initData.replace(/ /g, '+'))
    ])
  );

  const token = botToken.trim();
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();

  for (const variant of variants) {
    const params = new URLSearchParams(variant);
    const hash = params.get('hash');

    if (!hash) {
      continue;
    }

    const authDate = Number.parseInt(params.get('auth_date') ?? '0', 10);
    if (!Number.isFinite(authDate) || authDate <= 0) {
      continue;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (authDate > nowSeconds + 30) {
      continue;
    }

    if (nowSeconds - authDate > authTtl) {
      continue;
    }

    const candidates = [
      createDataCheckString(params, { includeSignature: true }),
      createDataCheckString(params, { includeSignature: false }),
      createDataCheckStringFromRaw(variant, { includeSignature: true }),
      createDataCheckStringFromRaw(variant, { includeSignature: false })
    ];

    const matched = candidates.some((candidate) => {
      const candidateHash = crypto.createHmac('sha256', secretKey).update(candidate).digest('hex');
      return secureCompareHex(candidateHash, hash);
    });

    if (!matched) {
      continue;
    }

    const user = parseUser(params.get('user'));
    if (!user) {
      continue;
    }

    verifyCache.set(cacheKey, {
      user,
      expiresAt: Date.now() + getVerifyCacheTtlMs()
    });

    return user;
  }

  return null;
};
