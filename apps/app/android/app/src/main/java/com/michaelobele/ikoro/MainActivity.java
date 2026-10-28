package com.michaelobele.ikoro;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.michaelobele.ikoro.alarm.IkoroAlarmPlugin;
import com.michaelobele.ikoro.dynamiccolors.IkoroDynamicColorsPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin MUST run before super.onCreate(). super.onCreate()
        // builds the Bridge and loads its plugins from the registration list,
        // so a plugin registered afterwards is never attached -- silently.
        // The symptom is a JS call to IkoroAlarm that rejects with "not
        // implemented", with nothing in logcat to explain why.
        registerPlugin(IkoroAlarmPlugin.class);
        registerPlugin(IkoroDynamicColorsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
