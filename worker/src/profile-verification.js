const CODE_LIFETIME_MS = 10 * 60_000;
const RESEND_DELAY_MS = 60_000;
const SEND_WINDOW_MS = 60 * 60_000;
const MAX_SENDS = 3;
const MAX_ATTEMPTS = 5;
const STORAGE_KEY = 'verification';
const encoder = new TextEncoder();

// One Durable Object per email coordinates attempts across Worker instances.
export class ClientProfileCodes {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const { action, challengeId, code } = await request.json();
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${challengeId}:${code}`)));
    const now = Date.now();

    return this.storage.transaction(async () => {
      const saved = await this.storage.get(STORAGE_KEY);
      if (action === 'issue') {
        const inWindow = saved?.windowEndsAt > now;
        if (saved?.resendAt > now || (inWindow && saved.sent >= MAX_SENDS)) {
          return new Response(null, { status: 429 });
        }

        const windowEndsAt = inWindow ? saved.windowEndsAt : now + SEND_WINDOW_MS;
        // Keep the last code usable through its full lifetime, even if the
        // hourly send window closes before the code expires.
        const expiresAt = now + CODE_LIFETIME_MS;
        await this.storage.put(STORAGE_KEY, {
          challengeId, hash, expiresAt,
          attempts: MAX_ATTEMPTS,
          resendAt: now + RESEND_DELAY_MS,
          sent: inWindow ? saved.sent + 1 : 1,
          windowEndsAt,
        });
        await this.storage.setAlarm(Math.max(windowEndsAt, expiresAt));
        return new Response(null, { status: 204 });
      }

      if (action !== 'verify' || saved?.challengeId !== challengeId
        || saved.expiresAt <= now || saved.attempts <= 0) {
        return new Response(null, { status: 400 });
      }

      let difference = 0;
      for (let i = 0; i < hash.length; i += 1) difference |= hash[i] ^ saved.hash[i];
      const valid = difference === 0;
      await this.storage.put(STORAGE_KEY, { ...saved, attempts: valid ? 0 : saved.attempts - 1 });
      return new Response(null, { status: valid ? 204 : 400 });
    });
  }

  async alarm() {
    // An already scheduled alarm can fire as a newer code is being issued.
    const saved = await this.storage.get(STORAGE_KEY);
    if (saved && Math.max(saved.windowEndsAt, saved.expiresAt) <= Date.now()) {
      await this.storage.delete(STORAGE_KEY);
    }
  }
}

export function profileVerificationConfigured(env) {
  return Boolean(env.CLIENT_PROFILE_CODES && env.RESEND_API_KEY && env.CLIENT_PROFILE_EMAIL_FROM);
}

export async function sendProfileCode(env, email, language, fetchImpl = globalThis.fetch) {
  const challengeId = crypto.randomUUID();
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000).padStart(8, '0');
  const issued = await checkCode(env, email, 'issue', challengeId, code);
  if (!issued.ok) return { status: issued.status };

  const spanish = language === 'es';
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `quote-profile-${challengeId}`,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      from: env.CLIENT_PROFILE_EMAIL_FROM,
      to: [email],
      subject: spanish ? 'Tu código de verificación de Esfenix' : 'Your Esfenix verification code',
      text: spanish
        ? `Tu código es ${code}. Vence en 10 minutos y solo se puede usar una vez. Si no lo solicitaste, puedes ignorar este correo.`
        : `Your code is ${code}. It expires in 10 minutes and can only be used once. If you didn’t request it, you can ignore this email.`,
    }),
  });
  if (!response.ok) return { status: 503 };
  return { status: 200, challengeId };
}

export async function verifyProfileCode(env, email, challengeId, code) {
  if (typeof challengeId !== 'string' || !/^[a-f0-9-]{36}$/.test(challengeId)
    || typeof code !== 'string' || !/^\d{8}$/.test(code)) return false;

  const response = await checkCode(env, email, 'verify', challengeId, code);
  if (!response.ok && response.status !== 400) throw new Error('Code verification is unavailable.');
  return response.ok;
}

function checkCode(env, email, action, challengeId, code) {
  const namespace = env.CLIENT_PROFILE_CODES;
  return namespace.get(namespace.idFromName(email)).fetch('https://profile-codes.internal/', {
    method: 'POST',
    body: JSON.stringify({ action, challengeId, code }),
  });
}
