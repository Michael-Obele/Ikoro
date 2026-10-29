package com.michaelobele.ikoro.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.michaelobele.ikoro.R

/**
 * WHY THIS FILE EXISTS
 *
 * This is the alarm. Everything else schedules or dismisses it; this is the part
 * that is still making noise when the phone is in a pocket, the screen is off and
 * the web view was never loaded.
 *
 * It is a FOREGROUND service for two reasons, both about the promise: a
 * background service gets killed when the system wants memory, and a dying
 * process takes the ringtone with it; and a foreground service is the only way an
 * app may keep running, and keep a notification, while the user is not looking at
 * it. The notification is not the alarm -- the audio and the full-screen screen
 * are. The notification is the price of staying alive.
 */
class IkoroAlarmService : Service() {

    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null

    /**
     * The sound the CURRENT ring was armed with, kept across the service's
     * actions so Snooze re-arms with the same ringtone. The snooze intent comes
     * from the ringing screen, which knows nothing about uri strings -- this
     * field is what carries the fact from the ring that just happened.
     */
    private var ringtone: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            // A START_STICKY restart delivers a null intent: the process was killed
            // and the alarm that caused it is gone, so there is no title to show and
            // no id to dismiss. Tearing down beats a permanently ringing service
            // that no button can silence.
            stopRinging()
            return START_NOT_STICKY
        }

        val id = intent.getIntExtra(IkoroAlarms.EXTRA_ID, -1)
        val taskId = intent.getStringExtra(IkoroAlarms.EXTRA_TASK_ID).orEmpty()
        val title = intent.getStringExtra(IkoroAlarms.EXTRA_TITLE).orEmpty()
        ringtone = intent.getStringExtra(IkoroAlarms.EXTRA_RINGTONE)

        when (intent.action) {
            ACTION_DISMISS -> {
                IkoroAlarmPlugin.notifyAlarmEvent(taskId, IkoroAlarmPlugin.EVENT_DISMISSED)
                stopRinging()
                return START_NOT_STICKY
            }

            ACTION_SNOOZE -> {
                // Re-arm BEFORE stopping the ring, so a failure to re-arm still
                // leaves the user with silence rather than a ringing phone they
                // have already answered.
                IkoroAlarms.snooze(this, id, taskId, title, ringtone)
                IkoroAlarmPlugin.notifyAlarmEvent(taskId, IkoroAlarmPlugin.EVENT_SNOOZED)
                stopRinging()
                return START_NOT_STICKY
            }
        }

        startRinging(id, taskId, title)
        // START_STICKY: if the system kills us mid-ring it should bring the alarm
        // back. The null-intent branch above is what makes that safe.
        return START_STICKY
    }

    override fun onDestroy() {
        releasePlayer()
        stopVibration()
        super.onDestroy()
    }

    private fun startRinging(id: Int, taskId: String, title: String) {
        // A second alarm arriving while one is already ringing must not stack a
        // second ringtone on top of the first -- two players at once is louder,
        // and neither of them is independently stoppable.
        releasePlayer()
        ensureChannel()

        val alarmIntent = Intent(this, IkoroAlarmActivity::class.java).apply {
            putExtra(IkoroAlarms.EXTRA_ID, id)
            putExtra(IkoroAlarms.EXTRA_TASK_ID, taskId)
            putExtra(IkoroAlarms.EXTRA_TITLE, title)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
        }

        val fullScreen = PendingIntent.getActivity(
            this,
            id,
            alarmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            // A DEDICATED monochrome glyph, not the launcher icon. The platform
            // draws a small icon as a SILHOUETTE: it keeps only the alpha channel
            // and repaints the shape. The coloured adaptive foreground
            // (ic_launcher_foreground) is opaque everywhere, so it rendered as a
            // featureless white blob in the status bar. ic_stat_alarm.xml carries
            // the glyph in its alpha, which is what the platform wants here.
            .setSmallIcon(R.drawable.ic_stat_alarm)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(title)
            // CATEGORY_ALARM is what tells the system, and any smartwatch or car
            // head unit in the loop, that this is an alarm and not a chat ping.
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            // Silent: the channel is silent and we own the sound, so the system
            // must not add a second copy of it.
            .setSilent(true)
            .setContentIntent(fullScreen)
            // THE line that makes this an alarm rather than a banner. Without it the
            // reminder waits in the shade until the user happens to look.
            .setFullScreenIntent(fullScreen, true)
            .build()

        // The TWO-argument form, deliberately. Per the Android 14 foreground
        // service types docs, "if the foreground service type is not specified in
        // the call, the type defaults to the values defined in the manifest" --
        // and the manifest declares exactly one (`systemExempted`). The explicit
        // path would be
        // ServiceCompat.startForeground(this, id, notification,
        // ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED), which hands
        // releases below API 34 a type bit that does not exist on them. Letting
        // the manifest supply the type is correct on every API level, which is why
        // it is the documented default rather than a shortcut.
        startForeground(id, notification)

        startPlayer()
        startVibration()
    }

    /**
     * Create the silent alarm channel once.
     *
     * Channels are runtime state, not manifest entries, and a notification posted
     * to a channel that does not exist is dropped without an error -- so this is
     * the difference between a ringing alarm and one that reports nothing at all.
     *
     * IMPORTANCE_HIGH is required for the full-screen intent to be honoured. The
     * sound is deliberately null and vibration deliberately off: we play the
     * audio and drive the vibrator ourselves, and a channel that also beeped
     * would double every alarm.
     */
    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(CHANNEL_ID, "Alarms", NotificationManager.IMPORTANCE_HIGH)
        channel.description = "Alarms that are ringing"
        channel.setSound(null, null)
        channel.enableVibration(false)
        manager.createNotificationChannel(channel)
    }

    /**
     * Play the ringtone, looping, until dismissed.
     *
     * USAGE_ALARM is what routes it through the alarm volume stream and, on most
     * devices, out of the alarm speaker even when the media stream is muted -- the
     * stream a silent-ringer user has already turned down. It is the correct
     * stream for this and the only one an alarm may use.
     *
     * The task's CHOSEN sound is tried first, then the device default. A picked
     * uri can go stale (a downloaded sound the user deleted, an OEM that moved
     * its media), and an alarm that cannot read its sound must still ring with
     * something: silence is the one outcome this product cannot afford.
     *
     * Everything is wrapped: a device with no alarm sound configured must produce
     * a screen and a vibration, not a crash in the middle of the night.
     */
    private fun startPlayer() {
        val fallback = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

        val candidates = buildList {
            ringtone?.let { add(Uri.parse(it)) }
            fallback?.let { add(it) }
        }

        if (candidates.isEmpty()) {
            Log.w(TAG, "no alarm or ringtone sound configured; ringing silently")
            return
        }

        for ((index, uri) in candidates.withIndex()) {
            // Created OUTSIDE the try: the catch releases it, and a val declared
            // inside the try is not in scope there.
            val created = MediaPlayer()
            try {
                created.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                created.setDataSource(this, uri)
                created.isLooping = true
                // Without the wake lock the ringtone stops the moment the screen sleeps,
                // which is exactly the state an alarm fires in.
                created.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK)
                created.prepare()
                created.start()
                player = created
                return
            } catch (error: Exception) {
                val which = if (index == 0 && candidates.size > 1) "the chosen" else "the default"
                Log.w(TAG, "could not play $which alarm ringtone; ${if (index == 0) "falling back" else "the alarm still shows"}", error)
                // Release the half-configured player rather than leaking it: it was
                // never assigned to the field, so nothing else can clean it up.
                try {
                    created.release()
                } catch (releaseError: Exception) {
                    Log.w(TAG, "could not release the failed ringtone player", releaseError)
                }
            }
        }
    }

    /** Vibrate a repeating pattern until dismissed, on whichever API this device has. */
    @Suppress("DEPRECATION")
    private fun startVibration() {
        try {
            val hardware: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val manager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                manager.defaultVibrator
            } else {
                getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            vibrator = hardware

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                // repeat index 0 loops the whole waveform, delays included.
                hardware.vibrate(VibrationEffect.createWaveform(VIBRATION_PATTERN, 0))
            } else {
                hardware.vibrate(VIBRATION_PATTERN, 0)
            }
        } catch (error: Exception) {
            Log.w(TAG, "could not start the alarm vibration", error)
        }
    }

    /**
     * Silence the alarm and tear the service down. Idempotent: the two buttons,
     * the notification swipe and a system kill can all reach it, more than once.
     */
    private fun stopRinging() {
        releasePlayer()
        stopVibration()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun releasePlayer() {
        val current = player ?: return
        player = null
        try {
            if (current.isPlaying) current.stop()
        } catch (error: Exception) {
            Log.w(TAG, "could not stop the alarm ringtone", error)
        }
        try {
            current.release()
        } catch (error: Exception) {
            Log.w(TAG, "could not release the alarm ringtone", error)
        }
    }

    private fun stopVibration() {
        val current = vibrator ?: return
        vibrator = null
        try {
            current.cancel()
        } catch (error: Exception) {
            Log.w(TAG, "could not cancel the alarm vibration", error)
        }
    }

    companion object {
        /** Sent by the ringing screen's Dismiss button. */
        const val ACTION_DISMISS = "ikoro.alarm.DISMISS"

        /** Sent by the ringing screen's Snooze button. */
        const val ACTION_SNOOZE = "ikoro.alarm.SNOOZE"

        private const val TAG = "IkoroAlarmService"

        /**
         * The alarm channel. Distinct from the JS-side `reminders` channel: this
         * one belongs to a ringing alarm and must never be used for a tap-on-the-
         * shoulder notification, because its importance is HIGH forever.
         */
        private const val CHANNEL_ID = "alarms"

        /** 700ms of buzz, 500ms of quiet, repeated. */
        private val VIBRATION_PATTERN = longArrayOf(0L, 700L, 500L)
    }
}
