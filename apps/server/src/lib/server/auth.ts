/**
 * Better Auth wired for WebViews and passkeys only: `bearer` because cookies are unusable in
 * Capacitor/Tauri, and no password exists anywhere.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { passkey } from '@better-auth/passkey';
import { twoFactor, bearer } from 'better-auth/plugins';
import { sql } from 'drizzle-orm';
import { db } from '#lib/db';
import { schema } from '#lib/db/schema';
import { envList, optionalEnv, requireEnv } from './env';

/** `.invalid` is reserved by RFC 2606, so it can never be registered or resolved. */
const SYNTHETIC_EMAIL_DOMAIN = 'ikoro.invalid';

/** Deterministic, collision-free address for a user id. Never delivered to. */
export function syntheticEmailFor(userId: string): string {
	return `passkey-${userId}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/**
 * Origins allowed to call the auth endpoints. Better Auth checks `Origin` on its own routes, so
 * the clients are listed even though the app uses a bearer token.
 */
function trustedOrigins(): string[] {
	const origins = new Set<string>();
	const own = optionalEnv('APP_ORIGIN');
	if (own) origins.add(own.replace(/\/+$/, ''));
	for (const origin of envList('TRUSTED_ORIGINS')) origins.add(origin.replace(/\/+$/, ''));
	return [...origins];
}

/**
 * Build the instance. Not at module scope: `secret` is a plain string option, so a top-level
 * `betterAuth()` reads it during SvelteKit's post-build `analyse` and fails `vite build`.
 */
function createAuth() {
	return betterAuth({
		appName: 'Ikoro',

		secret: requireEnv('BETTER_AUTH_SECRET', 'Generate one with: openssl rand -base64 32'),

		baseURL: optionalEnv('APP_ORIGIN'),
		trustedOrigins: trustedOrigins(),

		database: drizzleAdapter(db, {
			provider: 'pg',
			// Hand-authored schema, so the adapter resolves relations. Table and column names
			// are matched LITERALLY — see schema.ts.
			schema,
			usePlural: false
		}),

		/** There is no password. Ever. See the file header. */
		emailAndPassword: { enabled: false },

		plugins: [
			passkey({
				registration: {
					/** Also covers the second-device and backup-code recovery flows, which have no session. */
					requireSession: false,

					/** Mint the identity. Writes NOTHING — the id is only a proposal. */
					resolveUser: async ({ context }) => {
						const id = crypto.randomUUID();
						const name =
							(typeof context === 'string' && context.trim()) || `Ikoro user ${id.slice(0, 8)}`;
						return { id, name };
					},

					/**
					 * Create the user now — after the ceremony, before the passkey insert that references
					 * it. `DO NOTHING` because a second passkey resolves to the existing account's id.
					 */
					afterVerification: async ({ user }) => {
						await db.execute(
							sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
							    VALUES (${user.id}, ${user.name}, ${syntheticEmailFor(user.id)}, false, now(), now())
							    ON CONFLICT (id) DO NOTHING`
						);
					}
				}
			}),

			twoFactor({
				/** Without this the plugin demands a password for backup codes — a passkey-only user has none. */
				allowPasswordless: true
			}),

			bearer()
		]
	});
}

export type Auth = ReturnType<typeof createAuth>;

/** The Better Auth instance, built on first property read — same shape as the lazy Drizzle client. */
let instance: Auth | undefined;

export const auth = new Proxy({} as Auth, {
	get(_target, prop, receiver) {
		instance ??= createAuth();
		return Reflect.get(instance, prop, receiver);
	}
});

/** Test-only: whether the instance has been built yet. */
export function isAuthBuilt(): boolean {
	return instance !== undefined;
}
