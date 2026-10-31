import { db } from './schema';

/**
 * Seeds one list so a fresh install has somewhere to start -- guarded on `count() === 0`, so a user who deletes every list is not fought.
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
