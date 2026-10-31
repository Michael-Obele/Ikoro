package com.michaelobele.ikoro.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.michaelobele.ikoro.MainActivity

/**
 * WHY THIS FILE EXISTS
 *
 * Everything that touches AlarmManager, in one place, with NO Capacitor imports. The ringing screen
 * and the boot receiver both have to arm and re-arm alarms while the app is not running, so this
 * code cannot depend on a Bridge, a Plugin or a web view existing. Capacitor is the optional caller
 * here, not the owner.
 *
 * This is also the only file that decides HOW an alarm is armed, which is the decision the whole
 * product rests on.
 */
internal object IkoroAlarms {

    private const val TAG = "IkoroAlarms"

    const val EXTRA_ID = "ikoro.id"
    const val EXTRA_TASK_ID = "ikoro.taskId"
    const val EXTRA_TITLE = "ikoro.title"
    const val EXTRA_TRIGGER = "ikoro.triggerAtMillis"
    const val EXTRA_RINGTONE = "ikoro.ringtone"
    const val EXTRA_DESCRIPTION = "ikoro.description"

    /**
     * How far Snooze pushes an alarm out, in millis: the user's chosen length (see
     * [AlarmStore.snoozeMinutes]), five minutes on a device that has never been asked.
     */
    fun snoozeMillis(context: Context): Long = AlarmStore.snoozeMinutes(context) * 60_000L

    /**
     * Whether the OS will let us arm an exact alarm.
     *
     * Below API 31 there is no such permission and alarms are exact by default; the branch is not a
     * fallback for a failure, it is the correct answer for those versions.
     */
    fun canScheduleExact(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return alarmManager(context).canScheduleExactAlarms()
    }

    /**
     * Arm one alarm and record it.
     *
     * Returns false, and writes nothing, when the exact-alarm permission is missing. That false is
     * load-bearing: the caller reports it as a permission failure so the UI can offer the settings
     * screen. The alternative -- arming anyway and letting Android demote it to an inexact alarm --
     * produces a reminder that arrives whenever the system feels like it, with nothing anywhere
     * telling the user their promise was quietly broken.
     */
    fun schedule(
            context: Context,
            id: Int,
            taskId: String,
            title: String,
            triggerAtMillis: Long,
            ringtone: String? = null,
            description: String? = null
    ): Boolean {
        if (!canScheduleExact(context)) return false
        val alarm = StoredAlarm(id, taskId, title, triggerAtMillis, ringtone, description)
        if (!arm(context, alarm)) return false
        AlarmStore.put(context, alarm)
        return true
    }

    /**
     * Disarm one alarm and forget it.
     *
     * Safe to call for an id that was never armed or has already fired: the PendingIntent lookup
     * uses FLAG_NO_CREATE and is null-checked, because cancelling a PendingIntent that does not
     * exist is a no-op that some platforms treat as a NullPointerException.
     */
    fun cancel(context: Context, id: Int) {
        val existing =
                operation(
                        context,
                        id,
                        null,
                        PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
                )
        if (existing != null) alarmManager(context).cancel(existing)
        AlarmStore.remove(context, id)
    }

    /** What we believe is armed. The plugin exposes this to JS. */
    fun pending(context: Context): List<StoredAlarm> = AlarmStore.all(context)

    /**
     * Re-arm everything that is still in the future.
     *
     * AlarmManager does NOT survive a reboot or an app update -- its alarms live in the OS's own
     * scheduler and are dropped with the process that owned them. That is the entire reason this
     * function exists, and the entire reason AlarmStore exists to be its input.
     *
     * An entry whose moment has already passed is NEITHER re-armed NOR removed.
     *
     * Re-arming a past instant fires it immediately, and a reminder that goes off at boot for
     * something due yesterday is worse than one that never arrives. But deleting the entry threw
     * away the only record that the reminder existed: the store's JavaScript side is what reports
     * "missed while Ikoro was closed", and it can only do that from a row it can still see. So the
     * entry is left alone — disarmed, not forgotten — and the next `reconcile()` on app open
     * reports it and retires it.
     *
     * When the exact-alarm permission is missing, `schedule()` declines and the entry stays in the
     * store untouched. That is deliberate: the alarm is not lost, it is disarmed, and the next
     * reschedule after the user grants the permission picks it up again.
     */
    fun rescheduleAll(context: Context) {
        val now = System.currentTimeMillis()
        for (alarm in AlarmStore.all(context)) {
            if (alarm.triggerAtMillis <= now) {
                // Still in the store, still visible to JS. `schedule()` is skipped
                // for the same reason it is skipped when permission is missing.
                continue
            }
            schedule(
                    context,
                    alarm.id,
                    alarm.taskId,
                    alarm.title,
                    alarm.triggerAtMillis,
                    alarm.ringtone,
                    alarm.description
            )
        }
    }

    /**
     * Push a ringing alarm out by the user's chosen snooze length.
     *
     * Snooze is a re-arm, not a second alarm: it reuses the same id, so the new alarm replaces the
     * old one in both AlarmManager and the store and a snoozed task can never end up with two
     * pending alarms.
     */
    fun snooze(context: Context, id: Int, taskId: String, title: String, ringtone: String? = null) {
        schedule(
                context,
                id,
                taskId,
                title,
                System.currentTimeMillis() + snoozeMillis(context),
                ringtone
        )
    }

    private fun alarmManager(context: Context): AlarmManager =
            context.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    /**
     * Arm [alarm] as a user-visible clock alarm.
     *
     * setAlarmClock, NOT setExactAndAllowWhileIdle, and the difference is the product. An
     * alarm-clock alarm is the one the OS treats as belonging to an alarm app: it is exempt from
     * Doze and app standby, the app is allowed to start a foreground service from it, and the
     * system surfaces the next alarm in its own UI. setExactAndAllowWhileIdle buys none of that --
     * it is the API for a job that may slip, and it is throttled to roughly one delivery per nine
     * minutes per app on a sleeping device.
     *
     * `show` is what the OS opens when the user taps the alarm in its clock UI. It points at
     * MainActivity rather than the ringing screen because by then the alarm is finished and the
     * user wants their list.
     */
    private fun arm(context: Context, alarm: StoredAlarm): Boolean {
        val manager = alarmManager(context)

        val operation =
                operation(
                        context,
                        alarm.id,
                        alarm,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                        ?: return false

        val show =
                PendingIntent.getActivity(
                        context.applicationContext,
                        alarm.id,
                        Intent(context, MainActivity::class.java).apply {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                        },
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

        // AlarmClockInfo(triggerTime, showIntent) -- trigger time FIRST. The
        // arguments are both "a time" and "a PendingIntent" shaped enough to be
        // swapped by mistake, and swapping them arms an alarm for epoch 0 with
        // the intent in the wrong slot.
        return try {
            manager.setAlarmClock(
                    AlarmManager.AlarmClockInfo(alarm.triggerAtMillis, show),
                    operation
            )
            true
        } catch (error: Exception) {
            // SecurityException is the documented one: on API 31+ setAlarmClock()
            // throws when SCHEDULE_EXACT_ALARM is missing. The caller checks the
            // permission first, so reaching this means it was revoked in the gap
            // between the check and the call. Returning false turns that race into
            // a reported permission failure rather than a crash inside a plugin
            // call -- or, via the boot receiver, a crash at startup.
            Log.w(TAG, "could not arm an exact alarm", error)
            false
        }
    }

    /**
     * The receiver PendingIntent for one alarm.
     *
     * The requestCode is the alarm id, and the extras are refreshed with FLAG_UPDATE_CURRENT so a
     * re-arm carries the current title. Extras are NOT part of PendingIntent identity -- only the
     * requestCode, action, data and component are -- so passing `null` here for the cancel path
     * still matches the PendingIntent that was armed.
     */
    private fun operation(
            context: Context,
            id: Int,
            alarm: StoredAlarm?,
            flags: Int
    ): PendingIntent? {
        val intent = Intent(context, IkoroAlarmReceiver::class.java)
        if (alarm != null) {
            intent.putExtra(EXTRA_ID, alarm.id)
            intent.putExtra(EXTRA_TASK_ID, alarm.taskId)
            intent.putExtra(EXTRA_TITLE, alarm.title)
            intent.putExtra(EXTRA_TRIGGER, alarm.triggerAtMillis)
            // Only when set: an intent extra that is absent and an extra that is
            // null read back the same, but omitting keeps the parcel small and
            // makes "this alarm wants the default sound" explicit in the payload.
            alarm.ringtone?.let { intent.putExtra(EXTRA_RINGTONE, it) }
            alarm.description?.let { intent.putExtra(EXTRA_DESCRIPTION, it) }
        }
        return PendingIntent.getBroadcast(context.applicationContext, id, intent, flags)
    }
}
