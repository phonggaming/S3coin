const TOKEN_KEY = 's3coin_auth_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
  retries = 2
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        ...options,
        headers,
      });

      const data = await response.json().catch(async () => {
        const text = await response.text().catch(() => '');
        return text ? { error: text } : null;
      });

      if (!response.ok) {
        const errorMsg =
          data?.error ||
          data?.message ||
          data?.reason ||
          (response.status === 500
            ? 'Lỗi máy chủ (500). Hệ thống đang đồng bộ dữ liệu, vui lòng thử lại sau giây lát.'
            : `Yêu cầu thất bại với mã lỗi ${response.status}`);
        throw new Error(errorMsg);
      }

      return data as T;
    } catch (err: any) {
      const isNetworkError = err?.name === 'TypeError' || err?.message?.includes('Failed to fetch');
      const isGet = !options.method || options.method.toUpperCase() === 'GET';

      if (attempt < retries && isNetworkError && isGet) {
        // Wait briefly before retrying (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Network request failed after retries');
}
