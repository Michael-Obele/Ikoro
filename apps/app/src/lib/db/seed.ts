import { db } from './schema';

/**
 * A brand-new install has no lists, and the UI is written in terms of "the
 * current list". Seeding one removes the empty-state-with-nowhere-to-go problem.
 *
 * Guarded on `count() === 0` rather than on "is there a list named Tasks", so a
 * user who deletes every list deliberately is not fought by a seed that puts one
 * back on the next launch. Idempotent: the second call is a no-op.
 */
export async function ensureSeeded(): Promise<void> {
        if ((await db.lists.count()) > 0) return;
        await db.lists.add({
                id: crypto.randomUUID(),
                name: 'Tasks',
                sortOrder: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                deletedAt: null,
                rev: null,
                dirty: 1
        });
}