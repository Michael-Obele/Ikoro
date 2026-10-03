/**
 * Better Auth, wired for a WebView client and for passkeys only.
 *
 * ── Why the `bearer` plugin is not optional ──────────────────────────────────
 * The app runs inside a Capacitor WebView (`capacitor://localhost`) and a Tauri
 * window (`https://localhost`). Cross-origin cookies are hostile in both: a
 * `SameSite=None; Secure` cookie from an `http://localhost` dev origin is
 * dropped outright, and `capacitor://localhost` has no secure-context cookie
 * story at all. So the app sends `Authorization: Bearer <token>` and the session
 * token lives in the platform's secure storage. Everything under `/api/v1`
 * authenticates from the header, never from a cookie.
 *
 * ── No password exists, anywhere ─────────────────────────────────────────────
 * `emailAndPassword` is DISABLED, so no code path in this server can create a
 * password. That makes "no password is ever created" a property of the code
 * rather than a promise about the UI.
 *
 * ── How a passkey-only user gets a `user` row ────────────────────────────────
 * Verified against `@better-auth/passkey@1.7.7`, not assumed:
 *
 *  - `resolveUser` must return `{ id, name }`. The `id` is the caller's to
 *    supply — the plugin does NOT create the user.
 *  - `afterVerification` runs BEFORE the plugin inserts the passkey row, which
 *    matters because `passkey.userId` has a foreign key to `user.id`. Creating
 *    the user there is the last moment it can be created without the insert
 *    failing.
 *  - It runs AFTER the WebAuthn ceremony succeeds. Creating the user earlier
 *    leaves an orphan account behind every time someone abandons the ceremony —
 *    a row with no credential, which can never sign in and has no recovery path,
 *    because recovery IS a passkey.
 *  - `email` is NOT NULL and UNIQUE in the schema, and a passkey ceremony
 *    collects no email, so one is synthesised. It uses the RFC 2606 `.invalid`
 *    TLD, which by definition can never resolve and can never belong to anyone.
 *    The user never types it, sees it, or receives mail at it.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { passkey } from '@better-auth/passkey';
import { twoFactor, bearer } from 'better-auth/plugins';
import { sql } from 'drizzle-orm';
import { db } from '#lib/db';
import { schema } from '#lib/db/schema';
import { envList, optionalEnv, requireEnv } from './env';

/**
 * The TLD for a synthetic, unreachable account address.
 *
 * `.invalid` is reserved by RFC 2606 precisely so it can never be registered or
 * resolved. A real domain here would eventually expire and be taken by someone.
 */
const SYNTHETIC_EMAIL_DOMAIN = 'ikoro.invalid';

/** Deterministic, collision-free address for a user id. Never delivered to. */
export function syntheticEmailFor(userId: string): string {
	return `passkey-${userId}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/**
 * Origins allowed to call the auth endpoints.
 *
 * `APP_ORIGIN` is this server's own public origin. `TRUSTED_ORIGINS` carries the
 * clients: the Capacitor WebView and the Tauri window. Both are needed even
 * though the app authenticates with a bearer token, because Better Auth validates
 * the `Origin` header on its own routes before it looks at a credential.
 */
function trustedOrigins(): string[] {
	const origins = new Set<string>();
	const own = optionalEnv('APP_ORIGIN');
	if (own) origins.add(own.replace(/\/+$/, ''));
	for (const origin of envList('TRUSTED_ORIGINS')) origins.add(origin.replace(/\/+$/, ''));
	return [...origins];
}

/**
 * Build the instance.
 *
 * Deliberately NOT called at module scope, for a concrete reason rather than a
 * precautionary one. `secret` is a plain `string` option
 * (`@better-auth/core/dist/types/init-options.d.mts` — verified, there is no
 * lazy form), so evaluating the options reads `BETTER_AUTH_SECRET` during module
 * evaluation. SvelteKit's post-build `analyse` step IMPORTS the built server
 * module in order to trace its routes, so a top-level `betterAuth()` fails
 * `vite build` on any machine without a `.env` — with an error about a secret,
 * for a build that has nothing to do with authentication.
 *
 * That is the same trap as the database client with a different variable, and it
 * was found by actually running the build rather than by reasoning about it.
 */
function createAuth() {
	return betterAuth({
		appName: 'Ikoro',

		secret: requireEnv('BETTER_AUTH_SECRET', 'Generate one with: openssl rand -base64 32'),

		baseURL: optionalEnv('APP_ORIGIN'),
		trustedOrigins: trustedOrigins(),

		database: drizzleAdapter(db, {
			provider: 'pg',
			// The hand-authored schema, passed as an object so the adapter's relations
			// resolve. It matches table and column names LITERALLY — see schema.ts.
			schema,
			usePlural: false
		}),

		/** There is no password. Ever. See the file header. */
		emailAndPassword: { enabled: false },

		plugins: [
			passkey({
				registration: {
					/**
					 * A passkey may be added to an account with no session: the
					 * second-device flow, and the recovery flow where someone holding a
					 * backup code registers a fresh passkey.
					 */
					requireSession: false,

					/**
					 * Mint the identity. This writes NOTHING — the id is only a proposal.
					 *
					 * `name` is required by the type and is NOT NULL in the schema, so a
					 * blank one is replaced here rather than left to fail at insert time.
					 */
					resolveUser: async ({ context }) => {
						const id = crypto.randomUUID();
						const name =
							(typeof context === 'string' && context.trim()) || `Ikoro user ${id.slice(0, 8)}`;
						return { id, name };
					},

					/**
					 * Create the user, but only now — after the ceremony succeeded and
					 * before the plugin inserts the passkey that references it.
					 *
					 * `ON CONFLICT (id) DO NOTHING` because adding a SECOND passkey to an
					 * existing account resolves to that account's id, and must not
					 * clobber it or its name.
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
				/**
				 * Without this the plugin demands a password before it will issue backup
				 * codes — and a passkey-only user has none, so recovery codes would be
				 * unreachable and a lost passkey would be permanent.
				 *
				 * Verified present in `better-auth@1.7.7`
				 * (`dist/plugins/two-factor/types.d.mts`).
				 */
				allowPasswordless: true
			}),

			bearer()
		]
	});
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * The Better Auth instance, built on first use.
 *
 * `hooks.server.ts` calls `auth.api.getSession(...)` and the auth route calls
 * `auth.handler(request)` — both are property reads, so the Proxy is
 * transparent to every caller and there is no call site to remember to change.
 *
 * The same shape as the lazy Drizzle client in `#lib/db`, for the same reason.
 */
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
