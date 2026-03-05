import crypto from 'node:crypto';

export interface TelegramInitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  is_premium?: boolean;
}

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

const createDataCheckString = (params: URLSearchParams): string => {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
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
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) {
    return null;
  }

  const authDate = Number.parseInt(params.get('auth_date') ?? '0', 10);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return null;
  }

  const dataCheckString = createDataCheckString(params);

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (!secureCompareHex(calculatedHash, hash)) {
    return null;
  }

  return parseUser(params.get('user'));
};
