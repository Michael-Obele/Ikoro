package com.michaelobele.ikoro.alarm

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.lang.ref.WeakReference
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * WHY THIS FILE EXISTS
 *
 * The bridge between the web layer and the real alarm. Everything it does is a thin translation:
 * parse the JS call, hand it to [IkoroAlarms], and report the outcome honestly. No scheduling logic
 * lives here, because the alarm also has to work when this plugin does not exist -- the app can be
 * killed, and the ringing screen and the boot receiver both have to arm alarms without a Bridge.
 *
 * The one thing this file owns is the JS CONTRACT, including the shape of every rejection, because
 * the TypeScript on the other side string-matches on it.
 *
 * IMPORTANT: this class must stay public. MainActivity.java calls
 * registerPlugin(IkoroAlarmPlugin.class), and a Kotlin `internal` class mangles its name and cannot
 * be referenced from Java at all.
 */
/**
 * The plugin instance currently attached to a Bridge, if any.
 *
 * File-level rather than a companion member so both this class and its companion can read it with
 * no visibility question in the way, and deliberately weak: this reference must never be the thing
 * that keeps a torn-down plugin, or its Activity, alive.
 */
private var liveInstance: WeakReference<IkoroAlarmPlugin>? = null

@CapacitorPlugin(
        name = "IkoroAlarm",
        permissions =
                [
                        // The alias is "notifications" on purpose: it is what the JS contract
                        // reports on, and it keeps POST_NOTIFICATIONS from leaking through the
                        // generic checkPermissions() method under a name JS would not expect.
                        Permission(
                                alias = "notifications",
                                strings = [Manifest.permission.POST_NOTIFICATIONS]
                        )]
)
class IkoroAlarmPlugin : Plugin() {

    override fun load() {
        liveInstance = WeakReference(this)
    }

    override fun handleOnDestroy() {
        liveInstance = null
    }

    // ------------------------------------------------------------------ schedule

    /**
     * Arm one alarm.
     *
     * in { id: number, taskId: string, title: string, at: string } out { platformId: string }
     *
     * Rejections, in the order they can happen:
     * - "schedule requires id, taskId and at" -- a malformed call
     * - "could not parse '<at>' as an ISO 8601 UTC instant"
     * - "refusing to arm an alarm in the past"
     * - "exact alarm permission is not granted ..." <- contains
     * ```
     *     "exact alarm permission", which is how JS tells a fixable permission
     *     problem apart from a genuine bug.
     * ```
     */
    @PluginMethod
    fun schedule(call: PluginCall) {
        val id = call.getInt("id")
        val taskId = call.getString("taskId")
        val at = call.getString("at")
        val title = call.getString("title").orEmpty()
        // Optional. Absent or blank means "the device default alarm sound".
        val ringtone = call.getString("ringtone")?.takeIf { it.isNotBlank() }
        // Optional. The task's notes, shown on the ringing screen.
        val description = call.getString("description")?.takeIf { it.isNotBlank() }

        if (id == null || taskId.isNullOrEmpty() || at.isNullOrEmpty()) {
            call.reject("schedule requires id, taskId and at")
            return
        }

        val triggerAtMillis = parseIsoUtc(at)
        if (triggerAtMillis == null) {
            call.reject("could not parse '$at' as an ISO 8601 UTC instant")
            return
        }

        // An alarm for a moment that has already passed would fire immediately, so
        // the user would be told about a task at the wrong time rather than the
        // right one. Refuse and let the caller decide what to do about it.
        if (triggerAtMillis <= System.currentTimeMillis()) {
            call.reject("refusing to arm an alarm in the past")
            return
        }

        // Checked here as well as inside IkoroAlarms so the rejection carries the
        // permission phrasing even if the two ever drift apart.
        if (!IkoroAlarms.canScheduleExact(context)) {
            call.reject(
                    "exact alarm permission is not granted; open the alarm settings to arm this reminder"
            )
            return
        }

        if (!IkoroAlarms.schedule(
                        context,
                        id,
                        taskId,
                        title,
                        triggerAtMillis,
                        ringtone,
                        description
                )
        ) {
            call.reject("could not arm the alarm: exact alarm permission was refused")
            return
        }

        // platformId is a STRING on the JS side: it is used as a Map key and as a
        // comparable in reconcile(), and an int there invites `===` comparisons
        // against a string that always come back false.
        call.resolve(JSObject().put("platformId", id.toString()))
    }

    // -------------------------------------------------------------------- cancel

    /**
     * Disarm one alarm. Idempotent: cancelling an alarm that already fired, or never existed,
     * succeeds. Returns {}.
     *
     * in { platformId: string } out {}
     */
    @PluginMethod
    fun cancel(call: PluginCall) {
        val platformId = call.getString("platformId")?.trim()
        val id = platformId?.toIntOrNull()

        if (id == null) {
            call.reject("cancel requires a numeric platformId")
            return
        }

        IkoroAlarms.cancel(context, id)
        call.resolve(JSObject())
    }

    /**
     * Disarm every alarm this app has armed. Used when the user turns reminders off wholesale.
     * Returns {}.
     *
     * in {} out {}
     */
    @PluginMethod
    fun cancelAll(call: PluginCall) {
        // pending() returns a snapshot, so cancelling while iterating it cannot
        // mutate the list underneath the loop.
        for (alarm in IkoroAlarms.pending(context)) {
            IkoroAlarms.cancel(context, alarm.id)
        }
        call.resolve(JSObject())
    }

    // ---------------------------------------------------------------- getPending

    /**
     * What the app believes is armed.
     *
     * in {} out { pending: string[] } // platformIds
     *
     * This is what reconciliation compares against the store. It reports OUR record, not the OS's
     * -- Android has no API to enumerate a package's pending alarms, which is the whole reason
     * AlarmStore exists.
     */
    @PluginMethod
    fun getPending(call: PluginCall) {
        val pending = JSArray()
        for (alarm in IkoroAlarms.pending(context)) {
            pending.put(alarm.id.toString())
        }
        call.resolve(JSObject().put("pending", pending))
    }

    // --------------------------------------------------------------- checkStatus

    /**
     * Everything the UI needs to decide whether it can promise an alarm.
     *
     * in {} out { notifications: "granted"|"denied"|"prompt",
     * ```
     *         exact: boolean,
     *         fullScreenIntent: boolean }
     * ```
     */
    @PluginMethod
    fun checkStatus(call: PluginCall) {
        val status = JSObject()
        status.put("notifications", notificationState())
        status.put("exact", IkoroAlarms.canScheduleExact(context))
        status.put("fullScreenIntent", canUseFullScreenIntent())
        call.resolve(status)
    }

    // ------------------------------------------------------- snooze / dismiss

    /**
     * Answer a ringing alarm from the WEB UI.
     *
     * The native ringing screen talks to the service directly, but it only appears when the system
     * allowed the full-screen takeover. With the app in the foreground there is no such screen, so
     * the in-app one needs a way to deliver the same two actions — and this is it: the same intents
     * the native buttons send, started from the bridge.
     */
    @PluginMethod
    fun snooze(call: PluginCall) = sendAlarmAction(call, IkoroAlarmService.ACTION_SNOOZE)

    @PluginMethod
    fun dismiss(call: PluginCall) = sendAlarmAction(call, IkoroAlarmService.ACTION_DISMISS)

    private fun sendAlarmAction(call: PluginCall, action: String) {
        val id = call.getInt("id")
        val taskId = call.getString("taskId")

        if (id == null || taskId.isNullOrEmpty()) {
            call.reject("$action requires id and taskId")
            return
        }

        val request =
                Intent(context, IkoroAlarmService::class.java).apply {
                    this.action = action
                    putExtra(IkoroAlarms.EXTRA_ID, id)
                    putExtra(IkoroAlarms.EXTRA_TASK_ID, taskId)
                    putExtra(IkoroAlarms.EXTRA_TITLE, call.getString("title").orEmpty())
                }

        try {
            context.startService(request)
            call.resolve()
        } catch (error: Exception) {
            // A ringing alarm that cannot be answered is worth surfacing: the
            // service is foreground, so reaching here means it is already gone.
            call.reject("could not $action the alarm: ${error.message}")
        }
    }

    // -------------------------------------------------------- requestNotifications

    /**
     * Ask for notification permission, and report what came back.
     *
     * in {} out { notifications: "granted"|"denied" }
     *
     * Below API 33 there is no runtime notification permission, so nothing is asked and the answer
     * is "granted" -- which is true: notifications are shown until the user turns them off in
     * system settings.
     *
     * ALWAYS resolves, never rejects: the caller wants the new state, and a rejection would force
     * it to guess.
     */
    @PluginMethod
    fun requestNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(JSObject().put("notifications", GRANTED))
            return
        }

        val state = notificationState()
        if (state != PROMPT) {
            // Already granted or already permanently denied. Asking either way
            // does nothing useful: on "denied" the dialog is gone for good and the
            // only route left is system settings.
            call.resolve(JSObject().put("notifications", state))
            return
        }

        // requestPermissionForAlias saves the call and hands it to the callback
        // below, which resolves it. A launcher that failed to register rejects
        // the call itself rather than throwing, so this catch is for genuinely
        // unexpected failures -- where settling with the state we can actually
        // read beats leaving the caller's promise hanging forever.
        try {
            requestPermissionForAlias("notifications", call, "notificationsCallback")
        } catch (error: Exception) {
            Log.w(TAG, "could not ask for notification permission", error)
            call.resolve(JSObject().put("notifications", notificationState()))
        }
    }

    /**
     * The permission result, read back from the same source checkStatus uses so the two can never
     * disagree.
     */
    @PermissionCallback
    private fun notificationsCallback(call: PluginCall) {
        call.resolve(JSObject().put("notifications", notificationState()))
    }

    // ---------------------------------------------------- openExactAlarmSettings

    /**
     * Open the system screen that grants exact alarms. Returns {}.
     *
     * in {} out {}
     *
     * Resolves even when the screen could not be opened: the caller's only goal is that the user
     * ends up somewhere they can fix this, and turning a device quirk into a rejected promise would
     * make the banner that called it report a problem with the alarm rather than with the hand-off.
     */
    @PluginMethod
    fun openExactAlarmSettings(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                context.startActivity(
                        Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                            data = Uri.parse("package:" + context.packageName)
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                )
            } catch (error: Exception) {
                Log.w(TAG, "could not open the exact alarm settings screen", error)
            }
        }
        call.resolve(JSObject())
    }

    // ------------------------------------ requestFullScreenIntentPermission

    /**
     * Open the Android 14+ screen that allows full-screen intents. Returns {}.
     *
     * in {} out {}
     *
     * Below API 34 the permission is granted at install and revocable only indirectly, so there is
     * nothing to open and this resolves immediately.
     */
    @PluginMethod
    fun requestFullScreenIntentPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            call.resolve(JSObject())
            return
        }

        try {
            context.startActivity(
                    Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                        data = Uri.parse("package:" + context.packageName)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
            )
            call.resolve(JSObject())
        } catch (error: Exception) {
            Log.w(TAG, "could not open the full-screen intent settings screen", error)
            call.reject("could not open the full-screen intent settings screen")
        }
    }

    // ------------------------------------------------------------ pickRingtone

    /**
     * Hand the user the SYSTEM ringtone picker and report what they chose.
     *
     * in { existing?: string } // the uri to pre-check, if any out { cancelled: boolean, uri:
     * string | null }
     *
     * The platform's own picker, launched with ACTION_RINGTONE_PICKER, rather than a list built in
     * the web view: it already lists every sound the device offers, previews each one on tap,
     * survives OEM customisations, and costs zero UI code here. `uri` is null ONLY when the user
     * picked Silent; cancelled=true means they backed out and the caller keeps what it had.
     */
    @PluginMethod
    fun pickRingtone(call: PluginCall) {
        val existing = call.getString("existing")?.takeIf { it.isNotBlank() }?.let(Uri::parse)

        val intent =
                Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
                    // ALARM, not RINGTONE: this sound loops on the alarm stream, so the
                    // list should be the sounds meant for alarms.
                    putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
                    putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
                    putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, true)
                    putExtra(
                            RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI,
                            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                    )
                    existing?.let { putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, it) }
                    putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Reminder sound")
                }

        try {
            startActivityForResult(call, intent, "ringtonePicked")
        } catch (error: Exception) {
            Log.w(TAG, "could not open the ringtone picker", error)
            call.reject("could not open the ringtone picker")
        }
    }

    /**
     * The picker's answer, delivered by Capacitor's activity-result machinery (the
     * `@ActivityCallback` name-matched path — the pre-3.0 `handleOnActivityResult` override no
     * longer exists in Capacitor 8).
     *
     * Backing out is NOT picking Silent: the picker yields no uri for both, and conflating them
     * would wipe the user's sound every time they closed it by mistake.
     */
    @ActivityCallback
    private fun ringtonePicked(call: PluginCall, result: ActivityResult) {
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) {
            call.resolve(JSObject().put("cancelled", true).put("uri", null as String?))
            return
        }
        val uri: Uri? =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    data.getParcelableExtra(
                            RingtoneManager.EXTRA_RINGTONE_PICKED_URI,
                            Uri::class.java
                    )
                } else {
                    @Suppress("DEPRECATION")
                    data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
                }
        // A null uri here with RESULT_OK means the user picked Silent.
        call.resolve(JSObject().put("cancelled", false).put("uri", uri?.toString()))
    }

    // ----------------------------------------------------------- ringtoneTitle

    /**
     * The display name of a picked sound, for showing "Bells" instead of a content:// uri in the
     * UI.
     *
     * in { uri: string } out { title: string | null }
     */
    @PluginMethod
    fun ringtoneTitle(call: PluginCall) {
        val uri = call.getString("uri")?.let(Uri::parse)
        val title = uri?.let { RingtoneManager.getRingtone(context, it)?.getTitle(context) }
        call.resolve(JSObject().put("title", title))
    }

    // --------------------------------------------------------- getBatteryStatus

    /**
     * The two facts that decide whether an alarm can be trusted on this device RIGHT NOW.
     *
     * in {} out { powerSaveMode: boolean, ignoringBatteryOptimizations: boolean }
     */
    @PluginMethod
    fun getBatteryStatus(call: PluginCall) {
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        call.resolve(
                JSObject()
                        .put("powerSaveMode", power.isPowerSaveMode)
                        .put(
                                "ignoringBatteryOptimizations",
                                power.isIgnoringBatteryOptimizations(context.packageName)
                        )
        )
    }

    // --------------------------------------------- requestIgnoreBatteryOptimizations

    /** Show the system dialog that puts Ikoro on the battery-optimisation allowlist. Returns {}. */
    @PluginMethod
    fun requestIgnoreBatteryOptimizations(call: PluginCall) {
        try {
            context.startActivity(
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:" + context.packageName)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
            )
            call.resolve(JSObject())
        } catch (error: Exception) {
            Log.w(TAG, "could not open the battery exemption dialog", error)
            call.reject("could not open the battery exemption dialog")
        }
    }

    // --------------------------------------------------- openBatterySaverSettings

    /**
     * Open the system battery-saver screen. Returns {}. Battery saver itself cannot be switched off
     * by an app -- pointing the user at the screen that can is the honest version of "turn it off".
     */
    @PluginMethod
    fun openBatterySaverSettings(call: PluginCall) {
        try {
            context.startActivity(
                    Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
            )
            call.resolve(JSObject())
        } catch (error: Exception) {
            Log.w(TAG, "could not open battery saver settings", error)
            call.reject("could not open battery saver settings")
        }
    }

    // ----------------------------------------------------------- snoozeMinutes

    /**
     * The user's chosen snooze length, in minutes.
     *
     * in {} out { minutes: number }
     *
     * SharedPreferences is the single source of truth -- the ringing screen and the service read
     * the same value with no Bridge -- so JS asks rather than keeping its own copy.
     */
    @PluginMethod
    fun getSnoozeMinutes(call: PluginCall) {
        call.resolve(JSObject().put("minutes", AlarmStore.snoozeMinutes(context)))
    }

    /**
     * Set the snooze length.
     *
     * in { minutes: number } out { minutes: number }
     *
     * Resolves with what was ACTUALLY stored: a value outside the offered set falls back to the
     * default, and the echo is how JS learns that instead of assuming its input was kept.
     */
    @PluginMethod
    fun setSnoozeMinutes(call: PluginCall) {
        val minutes = call.getInt("minutes")
        if (minutes == null) {
            call.reject("setSnoozeMinutes requires minutes")
            return
        }
        call.resolve(JSObject().put("minutes", AlarmStore.setSnoozeMinutes(context, minutes)))
    }

    // ------------------------------------------------------------------- helpers

    /**
     * Parse the JS side's ISO 8601 UTC instant.
     *
     * java.time is API 26+ and minSdk here is 24, so SimpleDateFormat it is. The pattern is exact
     * rather than lenient-by-accident: `new Date().toISOString()` always emits
     * `yyyy-MM-ddTHH:mm:ss.SSSZ`, and refusing to guess at anything else is better than silently
     * accepting a local-time string as UTC and arming an alarm hours off.
     */
    private fun parseIsoUtc(value: String): Long? {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        format.isLenient = false
        return try {
            format.parse(value)?.time
        } catch (error: Exception) {
            Log.w(TAG, "could not parse '$value' as an ISO 8601 UTC instant", error)
            null
        }
    }

    /**
     * The notification permission as the JS contract's three states.
     *
     * Below API 33 there is no runtime permission and notifications are on, so "granted" is the
     * truthful answer -- reporting "prompt" there would send the UI asking for something that
     * cannot be asked for.
     */
    private fun notificationState(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return GRANTED

        return when (getPermissionState("notifications")) {
            PermissionState.GRANTED -> GRANTED
            PermissionState.DENIED -> DENIED
            // PROMPT, PROMPT_WITH_RATIONALE, or null if the alias went missing.
            // All three mean "not granted, and asking is still worth trying".
            else -> PROMPT
        }
    }

    /**
     * Whether a full-screen intent will actually take over the screen.
     *
     * Android 14 added a user-revocable permission for this. When it is off, the alarm still rings
     * and the notification still appears -- but as a heads-up banner in the shade, which is
     * precisely the degradation the product must tell the user about rather than absorb.
     */
    private fun canUseFullScreenIntent(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return manager.canUseFullScreenIntent()
    }

    /**
     * Hand an alarm lifecycle event to JS. Called by the service and the ringing screen, both of
     * which can run with no web view at all.
     *
     * `hasListeners` is checked before notifying so an app that is not running costs nothing but a
     * lookup -- and so nothing is queued up to be delivered, late and out of context, the next time
     * JS attaches.
     */
    internal fun emitAlarmEvent(taskId: String, event: String) {
        if (taskId.isEmpty()) return
        if (!hasListeners(event)) return
        notifyListeners(event, JSObject().put("taskId", taskId))
    }

    companion object {
        private const val TAG = "IkoroAlarmPlugin"

        private const val GRANTED = "granted"
        private const val DENIED = "denied"
        private const val PROMPT = "prompt"

        /** The alarm started ringing, and the full-screen screen is up. */
        const val EVENT_RINGING = "alarmRinging"

        /** The user dismissed the alarm. */
        const val EVENT_DISMISSED = "alarmDismissed"

        /** The user snoozed the alarm; it is re-armed for their chosen length. */
        const val EVENT_SNOOZED = "alarmSnoozed"

        /**
         * Fire [event] for [taskId] at JS, if JS is there to hear it.
         *
         * Called from the service, which has no relation to the plugin instance and may run with
         * the Bridge long gone. Every path is guarded: no live plugin, no listener, or a bridge
         * that is mid-teardown must all be silent no-ops rather than a crash inside a ringing
         * alarm.
         */
        fun notifyAlarmEvent(taskId: String, event: String) {
            val plugin = liveInstance?.get() ?: return
            try {
                plugin.emitAlarmEvent(taskId, event)
            } catch (error: Exception) {
                Log.w(TAG, "could not deliver '$event' to JS", error)
            }
        }
    }
}
