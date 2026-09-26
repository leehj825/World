export const SERVER_HTTP_URL = 'http://localhost:2567'

async function callAuthEndpoint(
  path: '/auth/login' | '/auth/register',
  username: string,
  password: string,
): Promise<{ token?: string }> {
  const response = await fetch(`${SERVER_HTTP_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error ?? 'request failed')
  }

  return body
}

export async function register(username: string, password: string): Promise<void> {
  await callAuthEndpoint('/auth/register', username, password)
}

export async function login(username: string, password: string): Promise<string> {
  const { token } = await callAuthEndpoint('/auth/login', username, password)
  if (!token) {
    throw new Error('login succeeded but no token was returned')
  }
  return token
}
