// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import TaskRow from '$lib/components/task/TaskRow.svelte';
import type { Task } from '$lib/db/schema';

/**
 * `repo` is mocked rather than driven against a real database: what this test is
 * about is the row's own behaviour — does one click produce exactly one write,
 * with the right id — and a real IndexedDB round trip would only add timing noise
 * on top of that question.
 */
vi.mock('$lib/db/repo', () => ({
	toggleTask: vi.fn(async () => {})
}));

import * as repo from '$lib/db/repo';

function fixture(overrides: Partial<Task> = {}): Task {
	return {
		id: 'task-1',
		listId: 'list-1',
		title: 'Call the dentist',
		notes: null,
		dueDate: null,
		dueTime: null,
		priority: 0,
		parentId: null,
		repeat: null,
		completedAt: null,
		alarmAt: null,
		alarmId: null,
		alarmFiredAt: null,
		sortOrder: 0,
		createdAt: '2026-10-01T09:00:00.000Z',
		updatedAt: '2026-10-01T09:00:00.000Z',
		deletedAt: null,
		rev: null,
		dirty: 1,
		...overrides
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

// `globals` is off in this workspace (every test imports from vitest explicitly),
// which also disables @testing-library/svelte's automatic afterEach cleanup.
// Without this, each render stays in the document and `getByRole` finds several.
afterEach(cleanup);

describe('TaskRow', () => {
	it('shows the task title', () => {
		render(TaskRow, { props: { task: fixture() } });
		expect(screen.getByText('Call the dentist')).toBeTruthy();
	});

	it('toggles the task exactly once per click, with the task id', async () => {
		render(TaskRow, { props: { task: fixture() } });

		await fireEvent.click(screen.getByRole('checkbox'));

		expect(repo.toggleTask).toHaveBeenCalledTimes(1);
		expect(repo.toggleTask).toHaveBeenCalledWith('task-1');
	});

	it('opens the editor when the title is clicked', async () => {
		const onopen = vi.fn();
		render(TaskRow, { props: { task: fixture(), onopen } });

		await fireEvent.click(screen.getByText('Call the dentist'));

		expect(onopen).toHaveBeenCalledTimes(1);
		expect(onopen.mock.calls[0][0]).toMatchObject({ id: 'task-1' });
	});

	it('does not toggle when the title is clicked', async () => {
		const onopen = vi.fn();
		render(TaskRow, { props: { task: fixture(), onopen } });

		await fireEvent.click(screen.getByText('Call the dentist'));

		expect(repo.toggleTask).not.toHaveBeenCalled();
	});

	it('marks a completed row as done, and strikes the title through', () => {
		render(TaskRow, { props: { task: fixture({ completedAt: '2026-10-02T10:00:00.000Z' }) } });

		const title = screen.getByText('Call the dentist');
		expect(title.getAttribute('data-done')).toBe('true');
		expect(title.className).toContain('line-through');
	});

	it('leaves an open row unmarked', () => {
		render(TaskRow, { props: { task: fixture() } });

		expect(screen.getByText('Call the dentist').getAttribute('data-done')).toBe('false');
	});

	it('labels the checkbox with the task it will tick', () => {
		render(TaskRow, { props: { task: fixture() } });

		expect(screen.getByRole('checkbox').getAttribute('aria-label')).toBe(
			'Mark "Call the dentist" as done'
		);
	});
});