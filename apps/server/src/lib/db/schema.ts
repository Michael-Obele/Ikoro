/**
 * The whole server schema, hand-authored. The Better Auth tables are generated output — regenerate,
 * do not retype. `rev` is ONE sequence across `list` and `task`, because the client cursor is one
 * number compared against both.
 */

import { relations } from 'drizzle-orm';
import {
	boolean,
	bigint,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp
} from 'drizzle-orm/pg-core';

// ── the shared revision sequence ──────────────────────────────────────────────

/**
 * The name of the ONE sequence `list.rev` and `task.rev` both draw from. Referenced by both
 * columns and by the explicit `nextval()` in queries.ts.
 */
export const REV_SEQUENCE_NAME = 'ikoro_rev_seq';

// ── Better Auth tables (generated; do not retype) ────────────────────────────

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').default(false).notNull(),
	image: text('image'),
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at')
		.$onUpdate(() => new Date())
		.notNull(),
	twoFactorEnabled: boolean('two_factor_enabled').default(false)
});

export const session = pgTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: timestamp('expires_at').notNull(),
		token: text('token').notNull().unique(),
		createdAt: timestamp('created_at').notNull(),
		updatedAt: timestamp('updated_at')
			.$onUpdate(() => new Date())
			.notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [index('session_userId_idx').on(t.userId)]
);

export const account = pgTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at'),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
		scope: text('scope'),
		password: text('password'),
		createdAt: timestamp('created_at').notNull(),
		updatedAt: timestamp('updated_at')
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [index('account_userId_idx').on(t.userId)]
);

export const verification = pgTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').notNull(),
		updatedAt: timestamp('updated_at')
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [index('verification_identifier_idx').on(t.identifier)]
);

export const passkey = pgTable(
	'passkey',
	{
		id: text('id').primaryKey(),
		name: text('name'),
		publicKey: text('public_key').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		credentialID: text('credential_id').notNull(),
		counter: integer('counter').notNull(),
		deviceType: text('device_type').notNull(),
		backedUp: boolean('backed_up').notNull(),
		transports: text('transports'),
		createdAt: timestamp('created_at'),
		aaguid: text('aaguid')
	},
	(t) => [
		index('passkey_userId_idx').on(t.userId),
		index('passkey_credentialID_idx').on(t.credentialID)
	]
);

export const twoFactor = pgTable(
	'two_factor',
	{
		id: text('id').primaryKey(),
		secret: text('secret').notNull(),
		backupCodes: text('backup_codes').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		verified: boolean('verified').default(true),
		failedVerificationCount: integer('failed_verification_count').default(0),
		lockedUntil: timestamp('locked_until')
	},
	(t) => [index('twoFactor_secret_idx').on(t.secret), index('twoFactor_userId_idx').on(t.userId)]
);

// ── sync: the idempotency ledger ─────────────────────────────────────────────
//
// Sync tables use `timestamptz`: a zone-less column silently shifts every instant by the session
// timezone, and `updatedAt` feeds LWW. Better Auth columns stay as generated.

/**
 * Every op id this server has ever committed, and the `rev` it was given. The primary key on `id`
 * IS the idempotency guarantee; `userId` lets a replay be rejected as `forbidden`.
 */
export const appliedOp = pgTable(
	'applied_op',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		entityId: text('entity_id').notNull(),
		rev: bigint('rev', { mode: 'number' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull()
	},
	(t) => [
		index('applied_op_userId_idx').on(t.userId),
		index('applied_op_createdAt_idx').on(t.createdAt)
	]
);

// ── sync: the change feed ────────────────────────────────────────────────────

/**
 * A task list, as the server stores it. `id` is client-generated (devices must agree offline),
 * and the payload is `jsonb` so the server's shape cannot drift from the wire's.
 */
export const list = pgTable(
	'list',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		payload: jsonb('payload').notNull(),
		/** The client LWW clock. An INPUT to the merge, never the authority. */
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
		/** Server-assigned, globally monotonic. The pull cursor. */
		rev: bigint('rev', { mode: 'number' }).generatedByDefaultAsIdentity({
			name: REV_SEQUENCE_NAME
		}),
		/** Non-null means deleted. Deletes are ALWAYS soft. */
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [index('list_userId_rev_idx').on(t.userId, t.rev)]
);

/** A task. Same contract as `list` — see the note there. */
export const task = pgTable(
	'task',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		payload: jsonb('payload').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
		rev: bigint('rev', { mode: 'number' }).generatedByDefaultAsIdentity({
			name: REV_SEQUENCE_NAME
		}),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [index('task_userId_rev_idx').on(t.userId, t.rev)]
);

/** Which table owns which entity kind. `@ikoro/sync` is the authority on the kinds. */
export const ENTITY_TABLES = { list, task } as const satisfies Record<string, unknown>;

// ── Relations v1 ─────────────────────────────────────────────────────────────

/** Relations v1, deliberately — not v2. The adapter degrades gracefully without them. */
export const userRelations = relations(user, ({ many }) => ({
	sessions: many(session),
	accounts: many(account),
	passkeys: many(passkey),
	twoFactors: many(twoFactor),
	lists: many(list),
	tasks: many(task),
	appliedOps: many(appliedOp)
}));

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, { fields: [session.userId], references: [user.id] })
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, { fields: [account.userId], references: [user.id] })
}));

export const passkeyRelations = relations(passkey, ({ one }) => ({
	user: one(user, { fields: [passkey.userId], references: [user.id] })
}));

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
	user: one(user, { fields: [twoFactor.userId], references: [user.id] })
}));

export const listRelations = relations(list, ({ one }) => ({
	user: one(user, { fields: [list.userId], references: [user.id] })
}));

export const taskRelations = relations(task, ({ one }) => ({
	user: one(user, { fields: [task.userId], references: [user.id] })
}));

export const appliedOpRelations = relations(appliedOp, ({ one }) => ({
	user: one(user, { fields: [appliedOp.userId], references: [user.id] })
}));

/**
 * What gets handed to `drizzle(neon(url), { schema })` and `drizzleAdapter(...)`. An explicit list,
 * not `export *`, so a new table cannot be missed here.
 */
export const schema = {
	user,
	session,
	account,
	verification,
	passkey,
	twoFactor,
	appliedOp,
	list,
	task,

	userRelations,
	sessionRelations,
	accountRelations,
	passkeyRelations,
	twoFactorRelations,
	listRelations,
	taskRelations,
	appliedOpRelations
};

/** The invariant that makes the pull cursor correct. Asserted in tests. */
export const REV_SEQUENCED_TABLES = [list, task] as const;

export type ListRow = typeof list.$inferSelect;
export type TaskRow = typeof task.$inferSelect;
export type AppliedOpRow = typeof appliedOp.$inferSelect;
export type UserRow = typeof user.$inferSelect;
