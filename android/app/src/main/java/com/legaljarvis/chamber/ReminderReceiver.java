package com.legaljarvis.chamber;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires a reminder or a daily briefing and re-arms the daily alarms. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String id = intent.getStringExtra("id");
        String kind = intent.getStringExtra("kind");
        if (kind == null) kind = "reminder";
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        if (id == null) id = "jarvis";
        Notifier.ensureChannels(context);

        PendingIntent content;
        if (kind.startsWith("briefing")) {
            String brief = kind.endsWith("morning") ? "morning" : "evening";
            content = Notifier.openApp(context, brief, id.hashCode() + 11);
            String displayBody = body != null && !body.trim().isEmpty()
                    ? body
                    : ("morning".equals(brief)
                        ? "Good morning, Sir. Your briefing is ready — tap to have me read it."
                        : "Good evening, Sir. Your briefing for tomorrow is ready — tap to have me read it.");
            String displayTitle = "morning".equals(brief) ? "Legal Jarvis · morning briefing" : "Legal Jarvis · evening briefing";
            Notifier.show(context, ("daily_" + brief).hashCode(), displayTitle, displayBody, kind, content);
            AlarmScheduler.scheduleNextDaily(context, kind);
        } else {
            content = Notifier.openApp(context, null, id.hashCode() + 11);
            String displayTitle = "task".equals(kind) ? "Chamber task" : "Chamber reminder";
            Notifier.show(context, id.hashCode(), displayTitle, title == null ? "A chamber reminder, Sir." : title, kind, content);
            AlarmScheduler.remove(context, id);
        }
    }
}
