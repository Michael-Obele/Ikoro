package com.michaelobele.ikoro.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * WHY THIS FILE EXISTS
 *
 * AlarmManager cannot start a service or an activity directly -- it delivers a
 * PendingIntent, and a broadcast is the cheapest thing to deliver. This receiver
 * is that hop, and nothing else: it takes the alarm's identity off the intent,
 * forgets the alarm, and hands off to the service that rings.
 *
 * It must stay this thin. A BroadcastReceiver gets about ten seconds of process
 * life and no promise of staying alive, so anything slow done here is work that
 * can be killed halfway. The noise, the notification and the vibration all
 * belong to the foreground service on the other side of that hand-off.
 */
class IkoroAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getStringExtra(IkoroAlarms.EXTRA_TASK_ID)
        if (taskId.isNullOrEmpty()) {
            // Without a task id there is nothing to name on the ringing screen and
            // no way to tell JS which task fired, so a "ring" would be an anonymous
            // noise the user cannot act on. Refusing is the honest outcome.
            Log.w(TAG, "alarm fired with no taskId; not ringing")
            return
        }

        val id = intent.getIntExtra(IkoroAlarms.EXTRA_ID, -1)
        val title = intent.getStringExtra(IkoroAlarms.EXTRA_TITLE).orEmpty()

        // It is ringing now, so it is no longer pending. Removing it here rather
        // than when the user dismisses it means a crash in the service cannot
        // leave a phantom alarm in the store that rescheduleAll would re-arm.
        AlarmStore.remove(context, id)

        val ring = Intent(context, IkoroAlarmService::class.java).apply {
            putExtra(IkoroAlarms.EXTRA_ID, id)
            putExtra(IkoroAlarms.EXTRA_TASK_ID, taskId)
            putExtra(IkoroAlarms.EXTRA_TITLE, title)
            putExtra(IkoroAlarms.EXTRA_TRIGGER, intent.getLongExtra(IkoroAlarms.EXTRA_TRIGGER, 0L))
        }

        try {
            ContextCompat.startForegroundService(context, ring)
        } catch (error: Exception) {
            // The realistic failure is a foreground-service start refused by a
            // background-restricted OS. Log it loudly rather than throwing out of a
            // broadcast receiver: an exception here would be reported as a crash in
            // the alarm app, which is the least debuggable failure mode available.
            Log.e(TAG, "could not start the alarm service for task $taskId", error)
        }
    }

    private companion object {
        const val TAG = "IkoroAlarmReceiver"
    }
}
