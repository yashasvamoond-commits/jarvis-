package com.legaljarvis.chamber;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restores the chamber diary alarms after a restart or an app update. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            AlarmScheduler.rescheduleAll(context);
        } catch (Exception ignored) {}
    }
}
