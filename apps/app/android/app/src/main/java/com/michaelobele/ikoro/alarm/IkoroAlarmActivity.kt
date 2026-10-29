package com.michaelobele.ikoro.alarm

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.michaelobele.ikoro.R

/**
 * WHY THIS FILE EXISTS
 *
 * The alarm has to be answerable at 6am on a locked phone with the app not running. This screen is
 * that: it appears over the lock screen, turns the display on, names the task, and offers exactly
 * two actions.
 *
 * IT MUST WORK WITH THE APP KILLED. Nothing on this screen may assume the web view exists, JS is
 * listening, or a Bridge is alive -- the user most often sets an alarm and then swipes the app
 * away. Any JS notification around a ringing alarm is a best-effort extra; THIS screen is the
 * source of truth, and it talks to IkoroAlarmService directly for that reason.
 *
 * It extends AppCompatActivity so the existing `AppTheme.NoActionBar` (parent
 * `Theme.AppCompat.DayNight.NoActionBar`) applies, which is the theme the manifest points this
 * activity at.
 */
class IkoroAlarmActivity : AppCompatActivity() {

    private var id = -1
    private var taskId = ""
    private var title = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Before setContentView, so the window is already lock-screen-visible by
        // the time it has anything to draw.
        showOverLockScreen()

        setContentView(R.layout.activity_alarm)

        // Registered ONCE. They deliberately read the CURRENT fields at tap time
        // rather than capturing a title or an id, which is what makes a second
        // alarm reuse this screen without the buttons going stale -- see
        // [onNewIntent].
        findViewById<Button>(R.id.alarm_snooze).setOnClickListener {
            sendToService(IkoroAlarmService.ACTION_SNOOZE)
            finish()
        }

        findViewById<Button>(R.id.alarm_dismiss).setOnClickListener {
            sendToService(IkoroAlarmService.ACTION_DISMISS)
            finish()
        }

        bind(intent)
    }

    /**
     * A SECOND alarm fired while this screen is already up.
     *
     * The manifest declares `launchMode="singleInstance"`, so Android does NOT create another
     * instance and `onCreate` does NOT run again: it reuses this one and delivers the new alarm
     * here instead. Without this override the screen would keep showing the FIRST alarm's title
     * while both buttons sent the first alarm's id and taskId -- so Dismiss marked the wrong task
     * as handled, and the second alarm was never reported to JS at all. Re-binding the same
     * instance to the intent it was just handed is what puts the visible title and the button
     * payloads back into agreement.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)

        // The platform does not refresh getIntent() for us. Without this, anything
        // reading `intent` later (a re-bind after a configuration change, the
        // dismiss path) would still see the first alarm.
        setIntent(intent)

        // No setContentView and no re-adding of listeners: the layout is already
        // inflated and the listeners read these fields live, so rebinding the
        // state is the whole job.
        bind(intent)
    }

    /**
     * Read id/taskId/title off [source] and put them on screen.
     *
     * The ONE place both entry points go through, so "what the screen shows" and "what the buttons
     * send" can never come from two different intents. That single-writer property is the fix for
     * the stale screen, not an accident.
     */
    private fun bind(source: Intent) {
        id = source.getIntExtra(IkoroAlarms.EXTRA_ID, -1)
        taskId = source.getStringExtra(IkoroAlarms.EXTRA_TASK_ID).orEmpty()
        title = source.getStringExtra(IkoroAlarms.EXTRA_TITLE).orEmpty()

        // A ringing alarm with no title would be a noise the user cannot place, so
        // fall back to the app name rather than showing an empty screen.
        findViewById<TextView>(R.id.alarm_title).text =
                title.ifEmpty { getString(R.string.app_name) }

        // The button says how long it actually snoozes. Re-bound with everything else,
        // so a settings change made while this screen is up still cannot desync the
        // label from what the service will do.
        findViewById<Button>(R.id.alarm_snooze).text =
                getString(R.string.alarm_snooze, AlarmStore.snoozeMinutes(this))

        // Best-effort: a no-op when no bridge or listener is attached. Emitted per
        // bind, so a second alarm is reported as ringing too.
        IkoroAlarmPlugin.notifyAlarmEvent(taskId, IkoroAlarmPlugin.EVENT_RINGING)
    }

    /**
     * Show over the lock screen and light it up.
     *
     * Two mechanisms because the API moved. setShowWhenLocked/setTurnScreenOn exist from API 27;
     * below that the same thing was the WindowManager flags, which still work and are still what
     * the platform reads. Both are permission-free, unlike the deprecated KeyguardLock path -- see
     * [dismissKeyguard].
     */
    @Suppress("DEPRECATION")
    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            window.addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        // Keep the display on while the user decides: an alarm on a screen that
        // times out after 30 seconds is an alarm the user has to wake twice.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        dismissKeyguard()
    }

    /**
     * Ask the system to drop the keyguard so the two buttons are directly tappable.
     *
     * requestDismissKeyguard is API 26+. There is deliberately NO KeyguardLock fallback below that:
     * newKeyguardLock() requires the DISABLE_KEYGUARD permission, which this app does not declare
     * on purpose. Below API 26 the activity still appears on top of the keyguard and is usable
     * after a swipe, which is the correct behaviour to degrade to.
     */
    private fun dismissKeyguard() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        try {
            // A null callback is allowed; there is nothing for us to do either way.
            keyguard.requestDismissKeyguard(this, null)
        } catch (error: Exception) {
            Log.w(TAG, "could not request keyguard dismissal", error)
        }
    }

    /**
     * Tell the service what the user chose.
     *
     * startService, not startForegroundService: the service is already running as a foreground
     * service (that is what is making the noise), so this only needs to deliver an action to it.
     */
    private fun sendToService(action: String) {
        val request =
                Intent(this, IkoroAlarmService::class.java).apply {
                    this.action = action
                    putExtra(IkoroAlarms.EXTRA_ID, id)
                    putExtra(IkoroAlarms.EXTRA_TASK_ID, taskId)
                    putExtra(IkoroAlarms.EXTRA_TITLE, title)
                }
        try {
            startService(request)
        } catch (error: Exception) {
            Log.w(TAG, "could not tell the alarm service to '$action'", error)
        }
    }

    private companion object {
        const val TAG = "IkoroAlarmActivity"
    }
}
