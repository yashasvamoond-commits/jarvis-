package com.legaljarvis.chamber;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONObject;

import java.util.Calendar;
import java.util.Iterator;

/** Schedules chamber reminders and the two daily briefings. */
final class AlarmScheduler {
    private AlarmScheduler() {}

    private static final String PREFS = "legal_jarvis_alarms";
    private static final String KEY_MAP = "scheduled";
    private static final String KEY_TIMES = "brief_times";
    static final String ACTION_FIRE = "com.legaljarvis.chamber.ALARM";

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static synchronized JSONObject map(Context c) {
        try {
            String s = prefs(c).getString(KEY_MAP, "{}");
            return new JSONObject(s);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static synchronized void saveMap(Context c, JSONObject o) {
        prefs(c).edit().putString(KEY_MAP, o.toString()).apply();
    }

    static void schedule(Context c, String id, long at, String title, String body, String kind) {
        if (id == null || id.isEmpty() || at <= 0) return;
        try {
            JSONObject m = map(c);
            JSONObject e = new JSONObject();
            e.put("at", at);
            e.put("title", title == null ? "Legal Jarvis" : title);
            e.put("body", body == null ? "" : body);
            e.put("kind", kind == null ? "reminder" : kind);
            m.put(id, e);
            saveMap(c, m);
            setAlarm(c, id, at, title, body, kind);
        } catch (Exception ignored) {}
    }

    private static void setAlarm(Context c, String id, long at, String title, String body, String kind) {
        Intent i = new Intent(c, ReminderReceiver.class);
        i.setAction(ACTION_FIRE);
        i.putExtra("id", id);
        i.putExtra("title", title);
        i.putExtra("body", body);
        i.putExtra("kind", kind);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getBroadcast(c, id.hashCode(), i, flags);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        boolean exact = true;
        if (Build.VERSION.SDK_INT >= 31) {
            try { exact = am.canScheduleExactAlarms(); } catch (Exception ignored) { exact = false; }
        }
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException se) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    static void cancel(Context c, String id) {
        if (id == null) return;
        try {
            JSONObject m = map(c);
            m.remove(id);
            saveMap(c, m);
            Intent i = new Intent(c, ReminderReceiver.class);
            i.setAction(ACTION_FIRE);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(c, id.hashCode(), i, flags);
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(pi);
        } catch (Exception ignored) {}
    }

    static void remove(Context c, String id) {
        try {
            JSONObject m = map(c);
            m.remove(id);
            saveMap(c, m);
        } catch (Exception ignored) {}
    }

    /** Re-register everything after a reboot or an app update. */
    static void rescheduleAll(Context c) {
        try {
            JSONObject m = map(c);
            long now = System.currentTimeMillis();
            Iterator<String> keys = m.keys();
            while (keys.hasNext()) {
                String id = keys.next();
                JSONObject e = m.optJSONObject(id);
                if (e == null) continue;
                long at = e.optLong("at", 0);
                if (at > now + 5000) {
                    setAlarm(c, id, at, e.optString("title"), e.optString("body"), e.optString("kind", "reminder"));
                }
            }
        } catch (Exception ignored) {}
        restoreDaily(c);
    }

    static void setDaily(Context c, String morning, String evening, boolean enabled) {
        try {
            JSONObject times = new JSONObject();
            times.put("morning", morning == null || morning.isEmpty() ? "08:30" : morning);
            times.put("evening", evening == null || evening.isEmpty() ? "19:30" : evening);
            times.put("enabled", enabled);
            prefs(c).edit().putString(KEY_TIMES, times.toString()).apply();
            cancelDaily(c);
            if (enabled) {
                scheduleNextDaily(c, "briefing_morning");
                scheduleNextDaily(c, "briefing_evening");
            }
        } catch (Exception ignored) {}
    }

    private static void cancelDaily(Context c) {
        for (String id : new String[]{"daily_morning", "daily_evening"}) {
            Intent i = new Intent(c, ReminderReceiver.class);
            i.setAction(ACTION_FIRE);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(c, id.hashCode(), i, flags);
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(pi);
        }
    }

    static void scheduleNextDaily(Context c, String kind) {
        try {
            String s = prefs(c).getString(KEY_TIMES, "");
            if (s == null || s.isEmpty()) return;
            JSONObject times = new JSONObject(s);
            if (!times.optBoolean("enabled", true)) return;
            boolean morning = kind.endsWith("morning");
            String hhmm = times.optString(morning ? "morning" : "evening", morning ? "08:30" : "19:30");
            String[] hm = hhmm.split(":");
            int h = Integer.parseInt(hm[0]);
            int m = hm.length > 1 ? Integer.parseInt(hm[1]) : 0;
            Calendar cal = Calendar.getInstance();
            cal.set(Calendar.HOUR_OF_DAY, h);
            cal.set(Calendar.MINUTE, m);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            if (cal.getTimeInMillis() <= System.currentTimeMillis() + 60_000) {
                cal.add(Calendar.DAY_OF_YEAR, 1);
            }
            String id = morning ? "daily_morning" : "daily_evening";
            String title = "Legal Jarvis";
            String body = morning ? "Your morning briefing is ready, Sir." : "Your evening briefing is ready, Sir.";
            setAlarm(c, id, cal.getTimeInMillis(), title, body, kind);
        } catch (Exception ignored) {}
    }

    static void restoreDaily(Context c) {
        try {
            String s = prefs(c).getString(KEY_TIMES, "");
            if (s == null || s.isEmpty()) return;
            JSONObject times = new JSONObject(s);
            if (!times.optBoolean("enabled", true)) return;
            scheduleNextDaily(c, "briefing_morning");
            scheduleNextDaily(c, "briefing_evening");
        } catch (Exception ignored) {}
    }
}
