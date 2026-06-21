import crypto from 'crypto';

export type TelegramAuthUser = {
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
};

const TELEGRAM_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 часа

function buildDataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function getTelegramSecretKey(botToken: string): Buffer {
  return crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
}

function verifyTelegramInitData(initData: string, botToken: string): TelegramAuthUser {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) {
    throw new Error('TELEGRAM_AUTH: hash is missing');
  }

  const authDateRaw = params.get('auth_date');
  const authDate = authDateRaw ? Number(authDateRaw) : NaN;

  if (!Number.isFinite(authDate)) {
    throw new Error('TELEGRAM_AUTH: auth_date is invalid');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - authDate > TELEGRAM_MAX_AGE_SECONDS) {
    throw new Error('TELEGRAM_AUTH: initData is expired');
  }

  const dataCheckString = buildDataCheckString(params);
  const secretKey = getTelegramSecretKey(botToken);
  const expectedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const hashBuffer = Buffer.from(hash, 'hex');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');

  if (
    hashBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(hashBuffer, expectedBuffer)
  ) {
    throw new Error('TELEGRAM_AUTH: invalid signature');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('TELEGRAM_AUTH: user is missing');
  }

  let parsedUser: any;
  try {
    parsedUser = JSON.parse(userRaw);
  } catch {
    throw new Error('TELEGRAM_AUTH: failed to parse user');
  }

  if (!parsedUser?.id) {
    throw new Error('TELEGRAM_AUTH: user.id is missing');
  }

  return {
    telegramId: Number(parsedUser.id),
    username: parsedUser.username ?? null,
    firstName: parsedUser.first_name ?? '',
    lastName: parsedUser.last_name ?? null,
    photoUrl: parsedUser.photo_url ?? null,
  };
}

export function getTelegramUserFromHeaders(headers: Headers): TelegramAuthUser {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error('CONFIG_ERROR: TELEGRAM_BOT_TOKEN is missing');
  }

  const initData = headers.get('x-telegram-init-data')?.trim();

  if (initData) {
    return verifyTelegramInitData(initData, botToken);
  }

  // fallback для локальной разработки
  if (process.env.NODE_ENV !== 'production') {
    const devTelegramId = Number(process.env.DEV_TELEGRAM_ID || 0);

    if (Number.isFinite(devTelegramId) && devTelegramId > 0) {
      return {
        telegramId: devTelegramId,
        username: process.env.DEV_TELEGRAM_USERNAME ?? 'dev_user',
        firstName: process.env.DEV_TELEGRAM_FIRST_NAME ?? 'Developer',
        lastName: null,
        photoUrl: null,
      };
    }
  }

  throw new Error('TELEGRAM_AUTH: x-telegram-init-data header is missing');
}

export function isTelegramAuthError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('TELEGRAM_AUTH:');
}

export function isConfigError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('CONFIG_ERROR:');
}