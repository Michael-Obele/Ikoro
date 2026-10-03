import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * The push endpoint's HTTP contract.
 *
 * Two things here are pure protocol decisions that are easy to get subtly wrong
 * and impossible to notice in a two-device test, so they are asserted directly
 * against the exported handler:
 *
 *  1. **The wire-version check must run BEFORE schema validation.** `pushRequestSchema`
 *     types `wireVersion` as `v.literal(WIRE_VERSION)`, so checking afterwards means
 *     an out-of-date client gets a generic 400 ("invalid value") instead of an
 *     actionable 409 telling it to update. Ordering is the whole behaviour.
 *  2. **`nextRev` must never be a rewind.** When every op is rejected, there is no
 *     rev to report; returning 0 invites a client to store 0 as its cursor and
 *     re-pull its entire history.
 *
 * `applyOps` and `currentRev` are mocked, so these tests need no database. The
 * mocked `currentRev` stands in for "the server's high-water mark", which is the
 * value the real one returns from the shared sequence.
 */

const KEYS = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'APP_ORIGIN'];
const applyOps = vi.hoisted(() => vi.fn());
const currentRev = vi.hoisted(() => vi.fn(async () => 4242));
const notify = vi.hoisted(() => vi.fn());

vi.mock('#lib/db/queries', async () => {
	const actual = await vi.importActual<typeof import('#lib/db/queries')>('#lib/db/queries');
	return { ...actual, applyOps, currentRev };
});

vi.mock('#lib/sse/hub', () => ({ notify }));

let saved: Record<string, string | undefined>;

beforeEach(() => {
	vi.resetModules();
	applyOps.mockReset();
	currentRev.mockClear();
	notify.mockClear();
	currentRev.mockResolvedValue(4242);
	applyOps.mockResolvedValue({ accepted: [], rejected: [], nextRev: 0 });

	saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
	process.env.BETTER_AUTH_SECRET = 'x'.repeat(32);
	process.env.APP_ORIGIN = 'http://localhost:5173';
});

afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

const validPayload = {
	id: 'task-1',
	listId: 'list-1',
	title: 'Buy milk',
	notes: null,
	dueDate: null,
	dueTime: null,
	priority: 0,
	parentId: null,
	repeat: null,
	completedAt: null,
	alarmAt: null,
	sortOrder: 0,
	createdAt: '2026-10-01T12:00:00.000Z',
	updatedAt: '2026-10-01T12:00:00.000Z',
	deletedAt: null
};

const op = (over: Record<string, unknown> = {}) => ({
	id: 'op-1',
	kind: 'task',
	entityId: 'task-1',
	op: 'upsert',
	payload: validPayload,
	updatedAt: '2026-10-02T12:00:00.000Z',
	...over
});

/**
 * Assert that NO op reached the query layer.
 *
 * Not `expect(applyOps).not.toHaveBeenCalled()`: the route filters ops first and
 * then always calls `applyOps` with whatever survived, so a batch where every op
 * was refused still calls it — with an empty array. What matters is that nothing
 * was handed to the database, not that a function was skipped.
 */
function expectNoOpsReachedDatabase() {
	expect(applyOps).toHaveBeenCalledWith('user-1', []);
}

async function post(body: unknown, userId: string | null = 'user-1') {
	const { POST } = await import('../src/routes/api/v1/changes/+server');
	return POST({
		request: new Request('http://localhost/api/v1/changes', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		locals: { userId, session: null }
	} as never);
}

describe('a mismatched wire version is a 409, not a 400', () => {
	it('tells the client which versions are involved', async () => {
		const res = await post({ wireVersion: 99, ops: [op()] });
		expect(res.status).toBe(409);

		const body = (await res.json()) as { error: string; message: string };
		expect(body.error).toBe('wire_version_mismatch');
		// The actionable half: the client is told what to do.
		expect(body.message).toContain('99');
		expect(body.message).toContain('Update the app');
	});

	it('applies nothing', async () => {
		await post({ wireVersion: 99, ops: [op()] });
		expect(applyOps).not.toHaveBeenCalled();
	});

	it('the matching version is accepted', async () => {
		applyOps.mockResolvedValue({
			accepted: [{ opId: 'op-1', entityId: 'task-1', rev: 7 }],
			rejected: [],
			nextRev: 7
		});
		const res = await post({ wireVersion: 1, ops: [op()] });
		expect(res.status).toBe(200);
		expect(applyOps).toHaveBeenCalledOnce();
	});
});

describe('nextRev is never a rewind', () => {
	it('reports the server high-water mark when every op is rejected', async () => {
		// The dangerous shape: nothing applied, so `applyOps` has no rev and returns
		// 0. A client storing 0 as its cursor re-pulls everything.
		applyOps.mockResolvedValue({ accepted: [], rejected: [], nextRev: 0 });
		const res = await post({ wireVersion: 1, ops: [op()] });
		const body = (await res.json()) as { nextRev: number };

		expect(body.nextRev).toBe(4242);
		expect(body.nextRev).toBeGreaterThan(0);
		expect(currentRev).toHaveBeenCalled();
	});

	it('reports the applied rev when something was applied', async () => {
		applyOps.mockResolvedValue({
			accepted: [{ opId: 'op-1', entityId: 'task-1', rev: 91 }],
			rejected: [],
			nextRev: 91
		});
		const res = await post({ wireVersion: 1, ops: [op()] });
		const body = (await res.json()) as { nextRev: number };

		expect(body.nextRev).toBe(91);
		// No extra query when the answer is already known.
		expect(currentRev).not.toHaveBeenCalled();
	});
});

describe('per-op validation does not fail the batch', () => {
	it('rejects a bad payload and still applies the good ops', async () => {
		// A phone that queued 300 edits must not lose all 300 because one payload
		// was truncated by a bad network.
		applyOps.mockResolvedValue({
			accepted: [{ opId: 'op-2', entityId: 'task-2', rev: 5 }],
			rejected: [],
			nextRev: 5
		});
		const res = await post({
			wireVersion: 1,
			ops: [op({ payload: { ...validPayload, title: 42 } }), op({ id: 'op-2', entityId: 'task-2' })]
		});

		const body = (await res.json()) as {
			accepted: { opId: string }[];
			rejected: { opId: string; reason: string }[];
		};
		expect(res.status).toBe(200);
		expect(body.rejected).toEqual([{ opId: 'op-1', reason: 'invalid' }]);
		expect(body.accepted).toHaveLength(1);
	});

	it('rejects a payload carrying a userId as forbidden, not silently', async () => {
		// Stripping the field quietly would hide the IDOR attempt; the op has to be
		// refused so it shows up in the client's `rejected` list.
		const res = await post({
			wireVersion: 1,
			ops: [op({ payload: { ...validPayload, userId: 'attacker' } })]
		});

		const body = (await res.json()) as { rejected: { opId: string; reason: string }[] };
		expect(body.rejected).toEqual([{ opId: 'op-1', reason: 'forbidden' }]);
		expectNoOpsReachedDatabase();
	});

	it('rejects a device-scoped alarmId rather than storing it', async () => {
		// A platform notification id from one phone is meaningless on another — and
		// a client that believes it was registered would think its alarm is armed.
		const res = await post({
			wireVersion: 1,
			ops: [op({ payload: { ...validPayload, alarmId: '9999' } })]
		});
		const body = (await res.json()) as { rejected: { reason: string }[] };
		expect(body.rejected).toEqual([{ opId: 'op-1', reason: 'forbidden' }]);
	});

	it('rejects an unknown kind at the envelope, naming the field', async () => {
		// `changeOpSchema` types `kind` as a picklist of ['list','task'], so an
		// unknown kind fails the WHOLE request before per-op validation runs. The
		// route's own `unknown-kind` branch is therefore a second gate behind this
		// one — kept deliberately, because a future loosening of the schema must
		// not turn into a SQL fragment built from an unchecked kind.
		const res = await post({ wireVersion: 1, ops: [op({ kind: 'reminder' })] });
		expect(res.status).toBe(400);

		const body = (await res.json()) as { error: string; message: string; issues?: string[] };
		expect(body.error).toBe('invalid_request');
		expect(body.issues?.join(' ')).toMatch(/kind/);
		expect(applyOps).not.toHaveBeenCalled();
	});
});

describe('only the session supplies userId', () => {
	it('401s with no session and never queries', async () => {
		const res = await post({ wireVersion: 1, ops: [op()] }, null);
		expect(res.status).toBe(401);
		expect(applyOps).not.toHaveBeenCalled();
	});

	it('passes the session userId through and ignores any in the body', async () => {
		applyOps.mockResolvedValue({
			accepted: [{ opId: 'op-1', entityId: 'task-1', rev: 1 }],
			rejected: [],
			nextRev: 1
		});
		await post({
			wireVersion: 1,
			ops: [op({ payload: { ...validPayload, userId: 'attacker' } })],
			userId: 'attacker'
		});
		// The payload's userId made it into `rejected`, and nothing that claimed a
		// foreign user reached the query layer.
		expectNoOpsReachedDatabase();
	});
});

describe('SSE is only woken when work was committed', () => {
	it('notifies on a real apply', async () => {
		applyOps.mockResolvedValue({
			accepted: [{ opId: 'op-1', entityId: 'task-1', rev: 3 }],
			rejected: [],
			nextRev: 3
		});
		await post({ wireVersion: 1, ops: [op()] });
		expect(notify).toHaveBeenCalledWith('user-1', 'change', { rev: 3 });
	});

	it('stays silent when nothing was committed', async () => {
		// A retry storm of pure replays must not become a notification storm.
		applyOps.mockResolvedValue({ accepted: [], rejected: [], nextRev: 0 });
		await post({ wireVersion: 1, ops: [op()] });
		expect(notify).not.toHaveBeenCalled();
	});
});

describe('malformed requests', () => {
	it('400s on non-JSON, naming the reason', async () => {
		const { POST } = await import('../src/routes/api/v1/changes/+server');
		const res = await POST({
			request: new Request('http://localhost/api/v1/changes', { method: 'POST', body: '{oops' }),
			locals: { userId: 'user-1', session: null }
		} as never);

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; message: string };
		expect(body.error).toBe('invalid_json');
		expect(body.message).toContain('not valid JSON');
	});

	it('413s an oversized body before parsing it', async () => {
		const { POST } = await import('../src/routes/api/v1/changes/+server');
		const res = await POST({
			request: new Request('http://localhost/api/v1/changes', {
				method: 'POST',
				body: 'x'.repeat(1_000_001)
			}),
			locals: { userId: 'user-1', session: null }
		} as never);

		expect(res.status).toBe(413);
		expect(applyOps).not.toHaveBeenCalled();
	});

	it('413s an oversized batch', async () => {
		const ops = Array.from({ length: 501 }, (_, i) => op({ id: `op-${i}` }));
		const res = await post({ wireVersion: 1, ops });
		expect(res.status).toBe(413);
		expect(applyOps).not.toHaveBeenCalled();
	});
});
