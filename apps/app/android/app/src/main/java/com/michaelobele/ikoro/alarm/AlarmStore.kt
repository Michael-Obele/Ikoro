package com.michaelobele.ikoro.alarm

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * WHY THIS FILE EXISTS
 *
 * An armed alarm lives in two places. One copy is inside AlarmManager -- the operating system's,
 * and the only one that can actually wake the device. The other is here: our record of what we
 * asked for. Android offers no API to enumerate the PendingIntents an app has armed, so without
 * this list the reboot path would have nothing to re-arm and every reminder in the app would be
 * silently lost the first time the phone restarts.
 *
 * SharedPreferences holding one JSON array, on purpose: it needs no new dependency, the blob is a
 * few hundred bytes, and nothing here is on a hot path.
 */
internal data class StoredAlarm(
    val id: Int,
    val taskId: String,
    val title: String,
    val triggerAtMillis: Long,
    /**
     * The sound this alarm should ring with, as a `content://` uri the user picked in the
     * system ringtone picker, or null for "the device default". Read back with `optString` and
     * mapped to null when absent, so blobs written before ringtones existed still parse.
     */
    val ringtone: String? = null,
    /**
     * The task's notes, shown on the ringing screen so the user can tell WHAT
     * this is without unlocking and opening the app. Null when the task has no
     * notes; parsed with `optString` so blobs written before it existed still
     * load.
     */
    val description: String? = null,
)

internal object AlarmStore {
    private const val TAG = "IkoroAlarmStore"

    private const val PREFS_NAME = "ikoro.alarms"

    /** The live blob. */
    private const val KEY_ARMED = "armed"

    /**
     * The previous blob, kept aside on every successful write.
     *
     * Only ever holds a blob that PARSED -- see [write]. Its whole job is to make corruption
     * recoverable: a truncated or half-flushed primary blob would otherwise be indistinguishable
     * from "the user has nothing armed", and the boot path would report an empty store and arm
     * nothing.
     */
    private const val KEY_ARMED_BACKUP = "armed.backup"

    private const val KEY_ID = "id"
    private const val KEY_TASK_ID = "taskId"
    private const val KEY_TITLE = "title"
    private const val KEY_TRIGGER = "triggerAtMillis"
    private const val KEY_RINGTONE = "ringtone"
    private const val KEY_DESCRIPTION = "description"

    /** The snooze lengths the UI offers. Anything else is not a choice a human made. */
    val SNOOZE_CHOICES = setOf(2, 5, 10, 15)

    /** The snooze length for a device that has never been asked. */
    const val DEFAULT_SNOOZE_MINUTES = 5

    private const val KEY_SNOOZE_MINUTES = "snoozeMinutes"

    /**
     * Always the application context: a store must never be the thing that keeps an Activity alive,
     * and the boot receiver has no Activity to hand it anyway.
     */
    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * Every alarm we believe is armed, oldest write first.
     *
     * A corrupt, truncated or half-written blob does NOT throw -- an exception escaping here would
     * run after every reboot and every app update, and would leave the user with nothing at all.
     * Instead it steps back to the last blob that parsed and, failing that, returns `emptyList()`,
     * so the next schedule still succeeds and still reports honestly. Both fallbacks are logged,
     * because "we lost your alarms" must never be silent.
     */
    @Synchronized
    fun all(context: Context): List<StoredAlarm> {
        val stored = prefs(context)
        val raw = stored.getString(KEY_ARMED, null) ?: return emptyList()

        parse(raw)?.let {
            return it
        }

        val backup = stored.getString(KEY_ARMED_BACKUP, null)
        val recovered = backup?.let { parse(it) }
        if (recovered != null) {
            Log.w(
                TAG,
                "the armed-alarm blob is corrupt; recovered ${recovered.size} alarm(s) from the backup copy",
            )
            return recovered
        }

        Log.e(
            TAG,
            "the armed-alarm blob is corrupt and no usable backup exists; " +
                "reporting an empty store rather than throwing",
        )
        return emptyList()
    }

    /**
     * Store [alarm], replacing any existing entry with the same id.
     *
     * Replace-by-id, never append-only. `id` is the 32-bit hash the JS side derives from the taskId
     * (`apps/app/src/lib/utils/id.ts::hashId`) and passes in, so one task always maps to one alarm.
     * Keeping the SAME id across reschedules is what stops re-arming from leaving a second alarm
     * behind for the same task -- the "my reminder fires twice" bug this product cannot have.
     *
     * WRITER INVARIANT, and why this is @Synchronized. This is a read-modify-write of a whole
     * SharedPreferences string, so two overlapping calls would each write a list that misses the
     * other's row -- losing an arm silently, and losing it from the boot re-arm set too. It is NOT
     * enough to rely on Capacitor serialising plugin calls on the bridge thread, because this
     * object has writers on the MAIN thread as well: [IkoroAlarmReceiver.onReceive] (which fires as
     * the alarm rings), [IkoroBootReceiver] via [IkoroAlarms.rescheduleAll], and
     * [IkoroAlarmService.onStartCommand] for snooze/dismiss. A dismiss tapped at the same moment JS
     * reschedules is exactly the pair that collides. The monitor is this singleton, and
     * `@Synchronized` is reentrant, so [all] and [write] inside it stay part of the same critical
     * section. Cost is a few-hundred-byte string under a lock on a non-hot path.
     */
    @Synchronized
    fun put(
        context: Context,
        alarm: StoredAlarm,
    ) {
        write(context, all(context).filterNot { it.id == alarm.id } + alarm)
    }

    @Synchronized
    fun remove(
        context: Context,
        id: Int,
    ) {
        val current = all(context)
        val remaining = current.filterNot { it.id == id }
        // Nothing matched, so nothing changed -- skip the disk write.
        if (remaining.size == current.size) return
        write(context, remaining)
    }

    /**
     * The user's chosen snooze length, in minutes.
     *
     * Lives here, in the same prefs file as the armed-alarm blob, because it is read by the ringing
     * screen and the service -- both of which run with no Bridge and no web layer. It is
     * deliberately NOT mirrored into the web store: two copies of a device setting is two chances
     * to disagree. A stored value outside [SNOOZE_CHOICES] (a future edit, a hand-poked prefs)
     * reads back as the default rather than arming something nobody chose.
     */
    fun snoozeMinutes(context: Context): Int =
        prefs(context).getInt(KEY_SNOOZE_MINUTES, DEFAULT_SNOOZE_MINUTES).takeIf {
            it in SNOOZE_CHOICES
        }
            ?: DEFAULT_SNOOZE_MINUTES

    /** Store [minutes] if it is one of the offered choices; returns what was ACTUALLY stored. */
    fun setSnoozeMinutes(
        context: Context,
        minutes: Int,
    ): Int {
        val stored = if (minutes in SNOOZE_CHOICES) minutes else DEFAULT_SNOOZE_MINUTES
        prefs(context).edit().putInt(KEY_SNOOZE_MINUTES, stored).apply()
        return stored
    }

    @Synchronized
    private fun write(
        context: Context,
        alarms: List<StoredAlarm>,
    ) {
        val stored = prefs(context)
        val editor = stored.edit()

        // Promote the outgoing blob to the backup FIRST, but only if it parses.
        // Promoting unconditionally would let a corrupt primary overwrite a good
        // backup -- poisoning the only recovery path there is. Re-parsing costs a
        // few hundred bytes and buys the guarantee that the backup is always good.
        val outgoing = stored.getString(KEY_ARMED, null)
        if (outgoing != null && parse(outgoing) != null) {
            editor.putString(KEY_ARMED_BACKUP, outgoing)
        }

        editor.putString(KEY_ARMED, serialize(alarms))
        // apply() rather than commit(): the caller is arming an alarm and must not
        // block on fsync, and a lost write only costs one re-schedule.
        editor.apply()
    }

    /**
     * The blob as a list, or `null` if it cannot be read at all.
     *
     * `null` is the "this blob is broken" signal [all] and [write] act on; an empty list is a
     * legitimately empty store. Collapsing the two would throw away the one fact the recovery
     * needs.
     *
     * A row with no taskId cannot be rung and cannot be traced back to anything the user
     * recognises, so it is not an alarm -- skipped, not fatal.
     */
    private fun parse(raw: String): List<StoredAlarm>? =
        try {
            val array = JSONArray(raw)
            val entries = mutableListOf<StoredAlarm>()
            for (index in 0 until array.length()) {
                val entry = array.optJSONObject(index) ?: continue
                val taskId = entry.optString(KEY_TASK_ID, "")
                if (taskId.isEmpty()) continue
                entries.add(
                    StoredAlarm(
                        id = entry.optInt(KEY_ID, 0),
                        taskId = taskId,
                        title = entry.optString(KEY_TITLE, ""),
                        triggerAtMillis = entry.optLong(KEY_TRIGGER, 0L),
                        ringtone = entry.optString(KEY_RINGTONE, "").ifEmpty { null },
                        description = entry.optString(KEY_DESCRIPTION, "").ifEmpty { null },
                    ),
                )
            }
            entries
        } catch (error: Exception) {
            Log.w(TAG, "could not read the armed-alarm blob", error)
            null
        }

    private fun serialize(alarms: List<StoredAlarm>): String {
        val array = JSONArray()
        for (alarm in alarms) {
            array.put(
                JSONObject().apply {
                    put(KEY_ID, alarm.id)
                    put(KEY_TASK_ID, alarm.taskId)
                    put(KEY_TITLE, alarm.title)
                    put(KEY_TRIGGER, alarm.triggerAtMillis)
                    // Omitted entirely when null: an older app reading this blob
                    // still parses it, and "no key" is the same fact as "null".
                    alarm.ringtone?.let { put(KEY_RINGTONE, it) }
                    alarm.description?.let { put(KEY_DESCRIPTION, it) }
                },
            )
        }
        return array.toString()
    }
}
