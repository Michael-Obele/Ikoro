package com.michaelobele.ikoro.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * WHY THIS FILE EXISTS
 *
 * AlarmManager's alarms are held by the running system, not by us, and both a
 * reboot and an app update clear them. Without this receiver every reminder in
 * the app disappears the next time the phone restarts -- which users read as
 * "the app forgot my task", not "the OS dropped my alarm".
 *
 * It is a BroadcastReceiver for the same reason as the alarm receiver: the
 * system delivers these events as broadcasts, and the work is small.
 */
class IkoroBootReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        when (intent.action) {
            // BOOT_COMPLETED, not QUICKBOOT_POWERON: the latter is a
            // manufacturer-specific extra that does not exist on AOSP.
            // MY_PACKAGE_REPLACED covers the same loss for an app update, which
            // also cancels pending alarms.
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                try {
                    IkoroAlarms.rescheduleAll(context)
                } catch (error: Exception) {
                    // Never let this escape: a crash inside a boot receiver is
                    // reported against the alarm app at a moment the user cannot
                    // connect to anything they did.
                    Log.e(TAG, "could not re-arm alarms after ${intent.action}", error)
                }
            }
        }
    }

    private companion object {
        const val TAG = "IkoroBootReceiver"
    }
}
