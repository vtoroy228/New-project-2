import { getTelegramInitData } from './telegram';

export interface ApiUser {
  id: string;
  telegramId: string;
  username: string | null;
  avatarUrl: string | null;
  firstName: string;
  lastName: string | null;
  isPremium: boolean;
  isBanned: boolean;
  bestScore: number;
  totalGames: number;
  totalScore: string;
  totalPlayTime: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: ApiUser;
}

export interface GameResultPayload {
  score: number;
  playTime: number;
  obstacles: number;
  sessionId?: string;
}

export interface LeaderboardEntry {
  rank: number;
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  avatarUrl: string | null;
  score: number;
}

export interface GlobalLeaderboardResponse {
  top: LeaderboardEntry[];
  you: {
    rank: number;
    score: number;
  } | null;
  totalPlayers: number;
}

type AuthMode = 'required' | 'optional' | 'none';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const API_PREFIX = '/api';

const devLog = (message: string, details?: Record<string, unknown>): void => {
  if (!import.meta.env.DEV) {
    return;
  }

  if (details) {
    console.info(`[api] ${message}`, details);
    return;
  }

  console.info(`[api] ${message}`);
};

const getAuthHeaders = (mode: AuthMode): Record<string, string> => {
  if (mode === 'none') {
    return {};
  }

  const initData = getTelegramInitData();
  if (!initData) {
    if (mode === 'required') {
      throw new ApiError(401, 'Telegram authorization is unavailable');
    }

    return {};
  }

  devLog('auth header attached', { initDataLength: initData.length, mode });

  return {
    Authorization: `tma ${initData}`
  };
};

const request = async <TResponse>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    auth?: AuthMode;
    body?: unknown;
  } = {}
): Promise<TResponse> => {
  const { method = 'GET', auth = 'required', body } = options;

  const headers: Record<string, string> = {
    ...getAuthHeaders(auth)
  };

  const hasBody = body !== undefined && method !== 'GET';
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string } & TResponse;
  if (!response.ok) {
    devLog('request failed', { path, status: response.status, error: payload.error ?? 'unknown' });
    throw new ApiError(response.status, payload.error ?? 'Unexpected API error');
  }

  return payload;
};

export const validateAuth = async (): Promise<AuthResponse> => {
  return request<AuthResponse>('/auth/validate', {
    method: 'POST',
    auth: 'required',
    body: {}
  });
};

export const getMe = async (): Promise<AuthResponse> => {
  return request<AuthResponse>('/auth/me', {
    method: 'GET',
    auth: 'required'
  });
};

export const submitGameResult = async (payload: GameResultPayload) => {
  return request<{ ok: boolean; suspicious: boolean; scoreAccepted: boolean }>('/game/result', {
    method: 'POST',
    auth: 'required',
    body: payload
  });
};

export const getGlobalLeaderboard = async (): Promise<GlobalLeaderboardResponse> => {
  return request<GlobalLeaderboardResponse>('/leaderboard/global', {
    method: 'GET',
    auth: 'optional'
  });
};
