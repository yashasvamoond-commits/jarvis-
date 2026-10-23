package com.legaljarvis.chamber;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** Chamber notifications. */
final class Notifier {
    private Notifier() {}

    static final String CHANNEL_REMINDERS = "jarvis_reminders";
    static final String CHANNEL_BRIEFINGS = "jarvis_briefings";

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel rem = new NotificationChannel(CHANNEL_REMINDERS, c.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_HIGH);
        rem.setDescription("Hearing prep, limitation dates and chamber tasks");
        rem.enableVibration(true);
        NotificationChannel brief = new NotificationChannel(CHANNEL_BRIEFINGS, c.getString(R.string.channel_briefings), NotificationManager.IMPORTANCE_HIGH);
        brief.setDescription("Morning and evening briefings");
        brief.enableVibration(true);
        nm.createNotificationChannel(rem);
        nm.createNotificationChannel(brief);
    }

    static PendingIntent openApp(Context c, String briefKind, int requestCode) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (briefKind != null) i.putExtra("brief", briefKind);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(c, requestCode, i, flags);
    }

    static void show(Context c, int notifId, String title, String body, String kind, PendingIntent contentIntent) {
        ensureChannels(c);
        String channel = kind != null && kind.startsWith("briefing") ? CHANNEL_BRIEFINGS : CHANNEL_REMINDERS;
        String safeTitle = title == null || title.isEmpty() ? "Legal Jarvis" : title;
        String safeBody = body == null ? "" : body;
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channel)
                .setSmallIcon(R.drawable.ic_stat_jarvis)
                .setColor(0xFFC9A961)
                .setContentTitle(safeTitle)
                .setContentText(safeBody)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(safeBody))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true);
        if (contentIntent != null) b.setContentIntent(contentIntent);
        try {
            NotificationManagerCompat.from(c).notify(notifId, b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS has not been granted; JS will offer to enable it.
        }
    }
}
