import type { Task } from '$lib/db/schema';
import * as repo from '$lib/db/repo';
import { armAlarm, getScheduler } from '$lib/alarms/scheduler';
import type { ScheduleOutcome } from '$lib/alarms/types';
import { ringtoneFor } from '$lib/alarms/ringtone';
import { deriveAlarmAt, todayISO } from '$lib/utils/time';
import { nextOccurrence } from '$lib/utils/recurrence';

/**
 * Todoist-style advance-on-complete: repeating tasks move to the next date, never Done.
 * Returns the re-arm outcome so a failed or degraded alarm is never silent.
 */
export async function completeTask(task: Task): Promise<ScheduleOutcome | null> {
	if (task.repeat === null || task.completedAt !== null) {
		await repo.toggleTask(task.id);
		return null;
	}
	const next = nextOccurrence(task.dueDate ?? todayISO(), task.repeat);
	if (task.alarmId) await getScheduler().cancel(task.alarmId);
	const at = deriveAlarmAt(next, task.dueTime);
	await repo.updateTask(task.id, { dueDate: next, alarmAt: at, alarmId: null, alarmFiredAt: null });
	if (!at) return null;
	const outcome = await armAlarm(getScheduler(), {
		taskId: task.id,
		title: task.title,
		at,
		ringtone: ringtoneFor(task),
		description: task.notes
	});
	await repo.updateTask(task.id, { alarmId: outcome.ok ? outcome.platformId : null });
	return outcome;
}
