package com.legaljarvis.chamber;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.rendering.ImageType;
import com.tom_roush.pdfbox.rendering.PDFRenderer;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Legal Jarvis — the native chamber shell.
 * The console itself lives in assets/www. This activity gives it a real British
 * voice, listening ears, the document archive, and alarms that survive reboots.
 */
public class MainActivity extends Activity {
    private static final String TAG = "LegalJarvis";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/www/index.html";
    private static final int REQ_FILES = 4101;
    private static final int REQ_FOLDER = 4102;
    private static final int REQ_OPEN_DATA = 4103;
    private static final int REQ_SAVE_DATA = 4104;
    private static final int REQ_MIC = 4201;
    private static final int REQ_NOTIF = 4202;

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private boolean pageReady = false;
    private final List<Runnable> afterPage = new ArrayList<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final List<JSONObject> shareQueue = new ArrayList<>();

    /* TTS */
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private boolean ttsFailed = false;
    private final List<Runnable> ttsQueue = new ArrayList<>();
    private final Map<String, String> utteranceRequests = new HashMap<>();
    private int utteranceSeq = 0;

    /* speech recognition */
    private SpeechRecognizer recognizer;
    private boolean asrActive = false;
    private String asrLang = "en-IN";

    /* pickers and permissions */
    private PendingPicker picker;
    private final List<String> pendingMic = new ArrayList<>();
    private final List<String> pendingNotify = new ArrayList<>();

    private static class PendingPicker {
        String requestId;
        String kind;      // files | folder | openData | saveData
        String text;      // content for saveData
        String fileName;
        String mime;
    }

    /* ============================================================ */
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PDFBoxResourceLoader.init(getApplicationContext());
        Notifier.ensureChannels(this);
        buildWebView();
        initTts();
        handleIntent(getIntent());
    }

    private void buildWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF070B12);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        setContentView(webView);
        webView.setBackgroundColor(0xFF070B12);

        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse r = assetLoader.shouldInterceptRequest(request.getUrl());
                return r != null ? r : super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u.getHost() != null && u.getHost().equals(HOST)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                List<Runnable> copy = new ArrayList<>(afterPage);
                afterPage.clear();
                for (Runnable r : copy) {
                    try { r.run(); } catch (Exception ignored) {}
                }
                flushShares();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                Log.e(TAG, "WebView error: " + error.getDescription());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                Log.d(TAG, "console " + m.message() + " @" + m.lineNumber());
                return true;
            }
        });

        webView.addJavascriptInterface(new Bridge(), "NativeBridge");
        webView.loadUrl(START_URL);
    }

    /* ============================================================
       JavaScript bridge
       ============================================================ */
    private class Bridge {
        @JavascriptInterface
        public String call(String method, String payloadJson) {
            try {
                JSONObject p = (payloadJson == null || payloadJson.trim().isEmpty())
                        ? new JSONObject() : new JSONObject(payloadJson);
                main.post(() -> handleCall(method, p));
            } catch (Exception e) {
                Log.e(TAG, "bridge parse error: " + e.getMessage());
            }
            return "";
        }
    }

    private void handleCall(String method, JSONObject p) {
        String id = p.optString("id", "");
        try {
            switch (method) {
                case "ping": {
                    JSONObject d = new JSONObject();
                    d.put("pong", true);
                    sendOk(id, d);
                    return;
                }
                case "info": sendOk(id, info()); return;
                case "voices": voices(id); return;
                case "speak": speak(id, p); return;
                case "stopSpeak": stopSpeaking(id); return;
                case "listen": listen(id, p); return;
                case "stopListen": stopListening(id); return;
                case "micPermission": micPermission(id, p.optBoolean("request", false)); return;
                case "notifyPermission": notifPermission(id, p.optBoolean("request", false)); return;
                case "pickFiles": pickFiles(id); return;
                case "pickFolder": pickFolder(id); return;
                case "scanFolder": scanFolder(id, p); return;
                case "extractText": extractText(id, p); return;
                case "importFile": importFile(id, p); return;
                case "openFile": openFile(id, p); return;
                case "shareFile": shareFile(id, p); return;
                case "moveFile": moveFile(id, p); return;
                case "deleteFile":
                case "deleteArchiveFile": deleteFile(id, p); return;
                case "readFile": readFile(id, p); return;
                case "renderPdf": renderPdf(id, p); return;
                case "pickBackup": pickBackup(id, p); return;
                case "saveBackup": saveBackup(id, p); return;
                case "exportArchive": exportArchive(id); return;
                case "openArchiveFolder": openArchiveFolder(id); return;
                case "scheduleAlarm": scheduleAlarm(id, p); return;
                case "cancelAlarm": cancelAlarm(id, p); return;
                case "setDailyBrief": setDailyBrief(id, p); return;
                case "notifyNow": notifyNow(id, p); return;
                case "openTtsSettings": openTtsSettings(id); return;
                case "pendingImports": {
                    JSONObject d = new JSONObject();
                    d.put("files", new JSONArray());
                    sendOk(id, d);
                    return;
                }
                case "setExactAlarmPermission": {
                    if (Build.VERSION.SDK_INT >= 31) {
                        try {
                            Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                            i.setData(Uri.parse("package:" + getPackageName()));
                            startActivity(i);
                        } catch (Exception ignored) {}
                    }
                    sendOk(id, new JSONObject());
                    return;
                }
                default:
                    fail(id, "Unknown native method: " + method);
            }
        } catch (Exception e) {
            Log.e(TAG, "bridge " + method + " failed", e);
            fail(id, e.getMessage() == null ? "Native error" : e.getMessage());
        }
    }

    private JSONObject info() throws Exception {
        JSONObject d = new JSONObject();
        d.put("platform", "native");
        d.put("sdk", Build.VERSION.SDK_INT);
        d.put("model", Build.MANUFACTURER + " " + Build.MODEL);
        d.put("version", versionName());
        d.put("archiveDir", FileStore.root(this).getAbsolutePath());
        d.put("freeBytes", FileStore.root(this).getUsableSpace());
        d.put("hasTts", tts != null && !ttsFailed);
        d.put("hasRecognizer", SpeechRecognizer.isRecognitionAvailable(this));
        int count = 0;
        try {
            if (ttsReady && tts.getVoices() != null) count = tts.getVoices().size();
        } catch (Exception ignored) {}
        d.put("voiceCount", count);
        d.put("exactAlarms", exactAlarmsAllowed());
        return d;
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1.0";
        }
    }

    private boolean exactAlarmsAllowed() {
        if (Build.VERSION.SDK_INT < 31) return true;
        try {
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            return am != null && am.canScheduleExactAlarms();
        } catch (Exception e) {
            return false;
        }
    }

    /* ============================================================
       Voice out — TextToSpeech
       ============================================================ */
    private void initTts() {
        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            ttsFailed = !ttsReady;
            if (ttsReady) {
                try {
                    tts.setAudioAttributes(new android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_ASSISTANT)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build());
                } catch (Exception ignored) {}
                tts.setLanguage(Locale.UK);
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {
                        emitTts("ttsStart", utteranceId);
                    }

                    @Override
                    public void onDone(String utteranceId) {
                        String req = utteranceRequests.remove(utteranceId);
                        if (req != null) sendOk(req, new JSONObject());
                        emitTts("ttsEnd", utteranceId);
                    }

                    @Override
                    public void onError(String utteranceId) {
                        String req = utteranceRequests.remove(utteranceId);
                        if (req != null) fail(req, "tts-error");
                        emitTts("ttsEnd", utteranceId);
                    }

                    @Override
                    public void onError(String utteranceId, int errorCode) {
                        String req = utteranceRequests.remove(utteranceId);
                        if (req != null) fail(req, "tts-error-" + errorCode);
                        emitTts("ttsEnd", utteranceId);
                    }
                });
            }
            List<Runnable> copy = new ArrayList<>(ttsQueue);
            ttsQueue.clear();
            for (Runnable r : copy) {
                try { r.run(); } catch (Exception ignored) {}
            }
        });
    }

    private void enqueueTts(Runnable r) {
        if (ttsReady || ttsFailed) r.run();
        else ttsQueue.add(r);
    }

    private void emitTts(String event, String utteranceId) {
        try {
            JSONObject d = new JSONObject();
            d.put("utteranceId", utteranceId == null ? "" : utteranceId);
            emit(event, d);
        } catch (Exception ignored) {}
    }

    private void voices(String id) {
        enqueueTts(() -> {
            try {
                JSONArray arr = new JSONArray();
                if (ttsReady && tts.getVoices() != null) {
                    List<Voice> list = new ArrayList<>(tts.getVoices());
                    Collections.sort(list, new Comparator<Voice>() {
                        @Override
                        public int compare(Voice a, Voice b) {
                            return Integer.compare(voiceScore(b), voiceScore(a));
                        }
                    });
                    for (Voice v : list) {
                        String tag = v.getLocale() == null ? "" : v.getLocale().toLanguageTag();
                        if (!tag.toLowerCase(Locale.ROOT).startsWith("en") && !tag.toLowerCase(Locale.ROOT).startsWith("hi")) continue;
                        JSONObject o = new JSONObject();
                        o.put("name", v.getName());
                        o.put("locale", tag);
                        o.put("local", !v.isNetworkConnectionRequired());
                        o.put("quality", v.getQuality());
                        o.put("latency", v.getLatency());
                        arr.put(o);
                    }
                }
                JSONObject d = new JSONObject();
                d.put("voices", arr);
                sendOk(id, d);
            } catch (Exception e) {
                fail(id, e.getMessage());
            }
        });
    }

    private int voiceScore(Voice v) {
        String tag = v.getLocale() == null ? "" : v.getLocale().toLanguageTag();
        String n = v.getName() == null ? "" : v.getName().toLowerCase(Locale.ROOT);
        int s = 0;
        if (tag.startsWith("en-GB")) s += 100;
        else if (tag.startsWith("en-IN")) s += 60;
        else if (tag.startsWith("hi")) s += 40;
        else if (tag.startsWith("en")) s += 20;
        if (n.contains("male") && !n.contains("female")) s += 12;
        if (n.contains("gb") || n.contains("rjs") || n.contains("gbb") || n.contains("gbd")) s += 6;
        if (!v.isNetworkConnectionRequired()) s += 4;
        if (v.getQuality() >= Voice.QUALITY_HIGH) s += 2;
        return s;
    }

    private void speak(String id, JSONObject p) {
        enqueueTts(() -> {
            if (!ttsReady) {
                fail(id, "text-to-speech unavailable");
                emitTts("ttsEnd", "");
                return;
            }
            String text = p.optString("text", "").trim();
            if (text.isEmpty()) { sendOk(id, new JSONObject()); return; }
            String lang = p.optString("lang", "en-GB");
            float rate = (float) clamp(p.optDouble("rate", 0.94), 0.4, 1.6);
            float pitch = (float) clamp(p.optDouble("pitch", 0.88), 0.5, 2.0);
            float volume = (float) clamp(p.optDouble("volume", 1.0), 0.0, 1.0);
            String voiceName = p.optString("voice", "");
            try { tts.stop(); } catch (Exception ignored) {}
            try { tts.setSpeechRate(rate); tts.setPitch(pitch); } catch (Exception ignored) {}
            Voice chosen = null;
            if (!voiceName.isEmpty()) {
                try {
                    Set<Voice> all = tts.getVoices();
                    if (all != null) {
                        for (Voice v : all) {
                            if (v.getName().equalsIgnoreCase(voiceName)) { chosen = v; break; }
                        }
                    }
                } catch (Exception ignored) {}
            }
            if (chosen == null) chosen = bestVoice(lang);
            if (chosen != null) {
                try {
                    tts.setLanguage(chosen.getLocale());
                    tts.setVoice(chosen);
                } catch (Exception ignored) {}
            } else {
                Locale loc = lang.toLowerCase(Locale.ROOT).startsWith("hi") ? new Locale("hi", "IN") : Locale.UK;
                try { tts.setLanguage(loc); } catch (Exception ignored) {}
            }
            String utteranceId = "lj_" + (++utteranceSeq);
            utteranceRequests.put(utteranceId, id);
            HashMap<String, String> params = new HashMap<>();
            params.put(TextToSpeech.Engine.KEY_PARAM_VOLUME, String.valueOf(volume));
            params.put(TextToSpeech.Engine.KEY_PARAM_STREAM, String.valueOf(AudioManager.STREAM_MUSIC));
            int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
            if (result == TextToSpeech.ERROR) {
                utteranceRequests.remove(utteranceId);
                fail(id, "Could not speak that");
                emitTts("ttsEnd", utteranceId);
                return;
            }
            // A silent TTS engine must not leave the console waiting forever.
            final String watchdogId = utteranceId;
            final String watchdogReq = id;
            main.postDelayed(() -> {
                if (utteranceRequests.containsKey(watchdogId)) {
                    utteranceRequests.remove(watchdogId);
                    try { if (tts != null) tts.stop(); } catch (Exception ignored) {}
                    sendOk(watchdogReq, new JSONObject());
                    emitTts("ttsEnd", watchdogId);
                }
            }, 20_000L + Math.min(120_000L, text.length() * 65L));
        });
    }

    private Voice bestVoice(String lang) {
        try {
            Set<Voice> all = tts.getVoices();
            if (all == null || all.isEmpty()) return null;
            boolean hindi = lang != null && lang.toLowerCase(Locale.ROOT).startsWith("hi");
            Voice best = null;
            int bestScore = Integer.MIN_VALUE;
            for (Voice v : all) {
                String tag = v.getLocale() == null ? "" : v.getLocale().toLanguageTag().toLowerCase(Locale.ROOT);
                if (hindi && !tag.startsWith("hi")) continue;
                if (!hindi && !tag.startsWith("en")) continue;
                int s = voiceScore(v);
                if (s > bestScore) { bestScore = s; best = v; }
            }
            return best;
        } catch (Exception e) {
            return null;
        }
    }

    private void stopSpeaking(String id) {
        try {
            if (tts != null) tts.stop();
        } catch (Exception ignored) {}
        for (Map.Entry<String, String> e : new ArrayList<>(utteranceRequests.entrySet())) {
            sendOk(e.getValue(), new JSONObject());
        }
        utteranceRequests.clear();
        emitTts("ttsEnd", "stop");
        sendOk(id, new JSONObject());
    }

    /* ============================================================
       Voice in — SpeechRecognizer
       ============================================================ */
    private void micPermission(String id, boolean request) {
        boolean granted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        if (granted || !request) {
            JSONObject d = new JSONObject();
            try { d.put("granted", granted); } catch (Exception ignored) {}
            sendOk(id, d);
            return;
        }
        pendingMic.add(id);
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
    }

    private void notifPermission(String id, boolean request) {
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= 33) {
            granted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        if (granted || !request || Build.VERSION.SDK_INT < 33) {
            JSONObject d = new JSONObject();
            try { d.put("granted", granted); } catch (Exception ignored) {}
            sendOk(id, d);
            return;
        }
        pendingNotify.add(id);
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_MIC) {
            for (String id : new ArrayList<>(pendingMic)) {
                try {
                    JSONObject d = new JSONObject();
                    d.put("granted", granted);
                    sendOk(id, d);
                } catch (Exception ignored) {}
            }
            pendingMic.clear();
            if (!granted) emitSpeechError("insufficient-permissions");
        } else if (requestCode == REQ_NOTIF) {
            for (String id : new ArrayList<>(pendingNotify)) {
                try {
                    JSONObject d = new JSONObject();
                    d.put("granted", granted);
                    sendOk(id, d);
                } catch (Exception ignored) {}
            }
            pendingNotify.clear();
        }
    }

    private void listen(String id, JSONObject p) {
        String lang = p.optString("lang", "en-IN");
        asrLang = lang;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            fail(id, "microphone permission not granted");
            emitSpeechError("insufficient-permissions");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            fail(id, "speech recognition unavailable");
            emitSpeechError("no-recognizer");
            return;
        }
        stopRecognition();
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new Listener());
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            recognizer.startListening(intent);
            asrActive = true;
            JSONObject d = new JSONObject();
            d.put("listening", true);
            sendOk(id, d);
        } catch (Exception e) {
            fail(id, e.getMessage());
            emitSpeechError("recognizer-error");
        }
    }

    private class Listener implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle params) {
            try {
                JSONObject d = new JSONObject();
                d.put("listening", true);
                emit("speechState", d);
            } catch (Exception ignored) {}
        }
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int eventType, Bundle params) {}

        @Override
        public void onError(int error) {
            if (!asrActive) return;
            asrActive = false;
            String mapped;
            switch (error) {
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                    mapped = "no-speech"; break;
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                    mapped = "insufficient-permissions"; break;
                case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                    mapped = "busy"; break;
                case SpeechRecognizer.ERROR_NETWORK:
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                    mapped = "network"; break;
                case SpeechRecognizer.ERROR_AUDIO:
                    mapped = "audio"; break;
                case SpeechRecognizer.ERROR_CLIENT:
                    mapped = "client"; break;
                default:
                    mapped = "recognizer-error";
            }
            emitSpeechError(mapped);
            cleanupAsr();
        }

        @Override
        public void onResults(Bundle results) {
            if (!asrActive) return;
            asrActive = false;
            ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String text = (list != null && !list.isEmpty()) ? list.get(0) : "";
            emitSpeech("final", text);
            cleanupAsr();
            emitSpeech("end", "");
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            if (!asrActive) return;
            ArrayList<String> list = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (list != null && !list.isEmpty()) emitSpeech("partial", list.get(0));
        }
    }

    private void emitSpeech(String type, String text) {
        try {
            JSONObject d = new JSONObject();
            d.put("type", type);
            d.put("text", text == null ? "" : text);
            d.put("lang", asrLang);
            emit("speech", d);
        } catch (Exception ignored) {}
    }

    private void emitSpeechError(String code) {
        try {
            JSONObject d = new JSONObject();
            d.put("type", "error");
            d.put("error", code);
            d.put("lang", asrLang);
            emit("speech", d);
        } catch (Exception ignored) {}
    }

    private void stopRecognition() {
        asrActive = false;
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) {}
            cleanupAsr();
        }
    }

    private void cleanupAsr() {
        if (recognizer != null) {
            try { recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    private void stopListening(String id) {
        boolean active = asrActive;
        stopRecognition();
        if (active) emitSpeech("end", "");
        sendOk(id, new JSONObject());
    }

    /* ============================================================
       Files & archive
       ============================================================ */
    private void pickFiles(String id) {
        if (picker != null) { fail(id, "A file picker is already open"); return; }
        PendingPicker pp = new PendingPicker();
        pp.requestId = id;
        pp.kind = "files";
        picker = pp;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "application/pdf", "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "text/plain", "application/rtf", "image/*"
        });
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try { startActivityForResult(i, REQ_FILES); }
        catch (Exception e) { picker = null; fail(id, "No file picker available: " + e.getMessage()); }
    }

    private void pickFolder(String id) {
        if (picker != null) { fail(id, "A picker is already open"); return; }
        PendingPicker pp = new PendingPicker();
        pp.requestId = id;
        pp.kind = "folder";
        picker = pp;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try { startActivityForResult(i, REQ_FOLDER); }
        catch (Exception e) { picker = null; fail(id, "No folder picker available: " + e.getMessage()); }
    }

    private void pickBackup(String id, JSONObject p) {
        if (picker != null) { fail(id, "A picker is already open"); return; }
        PendingPicker pp = new PendingPicker();
        pp.requestId = id;
        pp.kind = "openData";
        pp.mime = p.optString("mime", "*/*");
        picker = pp;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/csv", "application/json", "text/comma-separated-values", "application/octet-stream", "text/plain"});
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivityForResult(i, REQ_OPEN_DATA); }
        catch (Exception e) { picker = null; fail(id, "No file picker available: " + e.getMessage()); }
    }

    private void saveBackup(String id, JSONObject p) {
        if (picker != null) { fail(id, "A picker is already open"); return; }
        PendingPicker pp = new PendingPicker();
        pp.requestId = id;
        pp.kind = "saveData";
        pp.text = p.optString("text", "");
        pp.fileName = p.optString("filename", "LegalJarvis-Backup.json");
        picker = pp;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/json");
        i.putExtra(Intent.EXTRA_TITLE, pp.fileName);
        try { startActivityForResult(i, REQ_SAVE_DATA); }
        catch (Exception e) { picker = null; fail(id, "No file saver available: " + e.getMessage()); }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        PendingPicker pp = picker;
        picker = null;
        if (pp == null) return;
        if (resultCode != RESULT_OK || data == null) {
            JSONObject d = new JSONObject();
            try { d.put("cancelled", true); d.put("files", new JSONArray()); } catch (Exception ignored) {}
            sendOk(pp.requestId, d);
            return;
        }
        try {
            switch (pp.kind) {
                case "files": {
                    List<Uri> uris = new ArrayList<>();
                    ClipData clip = data.getClipData();
                    if (clip != null) {
                        for (int i = 0; i < clip.getItemCount(); i++) {
                            Uri u = clip.getItemAt(i).getUri();
                            if (u != null) uris.add(u);
                        }
                    } else if (data.getData() != null) {
                        uris.add(data.getData());
                    }
                    for (Uri u : uris) takeRead(u);
                    JSONArray arr = new JSONArray();
                    for (Uri u : uris) arr.put(FileStore.meta(this, u));
                    JSONObject d = new JSONObject();
                    d.put("files", arr);
                    sendOk(pp.requestId, d);
                    break;
                }
                case "folder": {
                    Uri tree = data.getData();
                    if (tree == null) { fail(pp.requestId, "No folder selected"); break; }
                    try {
                        getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } catch (Exception ignored) {}
                    final String reqId = pp.requestId;
                    final Uri treeUri = tree;
                    io.execute(() -> {
                        try {
                            List<JSONObject> files = FileStore.scanTree(MainActivity.this, treeUri);
                            JSONObject d = new JSONObject();
                            d.put("files", FileStore.arrayOf(files));
                            d.put("treeUri", treeUri.toString());
                            d.put("name", FileStore.treeName(MainActivity.this, treeUri));
                            sendOk(reqId, d);
                        } catch (Exception e) {
                            fail(reqId, e.getMessage());
                        }
                    });
                    break;
                }
                case "openData": {
                    Uri uri = data.getData();
                    if (uri == null) { fail(pp.requestId, "No file chosen"); break; }
                    takeRead(uri);
                    final String reqId = pp.requestId;
                    final Uri doc = uri;
                    io.execute(() -> {
                        try {
                            String text = readUriText(doc);
                            JSONObject d = new JSONObject();
                            d.put("name", FileStore.meta(MainActivity.this, doc).optString("name", "import"));
                            d.put("text", text);
                            sendOk(reqId, d);
                        } catch (Exception e) {
                            fail(reqId, "Could not read that file: " + e.getMessage());
                        }
                    });
                    break;
                }
                case "saveData": {
                    Uri uri = data.getData();
                    if (uri == null) { fail(pp.requestId, "No destination chosen"); break; }
                    final String reqId = pp.requestId;
                    final String content = pp.text;
                    final Uri dest = uri;
                    io.execute(() -> {
                        try (OutputStreamWriter w = new OutputStreamWriter(
                                getContentResolver().openOutputStream(dest), StandardCharsets.UTF_8)) {
                            w.write(content == null ? "" : content);
                            w.flush();
                            sendOk(reqId, new JSONObject());
                        } catch (Exception e) {
                            fail(reqId, e.getMessage());
                        }
                    });
                    break;
                }
            }
        } catch (Exception e) {
            fail(pp.requestId, e.getMessage());
        }
    }

    private void takeRead(Uri u) {
        try {
            getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}
    }

    private String readUriText(Uri uri) throws Exception {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("The file could not be opened");
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[32 * 1024];
            int n, total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > 30 * 1024 * 1024) throw new Exception("The file is too large");
                bos.write(buf, 0, n);
            }
            return bos.toString("UTF-8");
        }
    }

    private void scanFolder(String id, JSONObject p) {
        String tree = p.optString("treeUri", "");
        if (tree.isEmpty()) { fail(id, "No folder is linked"); return; }
        final Uri treeUri = Uri.parse(tree);
        io.execute(() -> {
            try {
                List<JSONObject> files = FileStore.scanTree(MainActivity.this, treeUri);
                JSONObject d = new JSONObject();
                d.put("files", FileStore.arrayOf(files));
                sendOk(id, d);
            } catch (Exception e) {
                fail(id, e.getMessage());
            }
        });
    }

    private void extractText(String id, JSONObject p) {
        String uriString = p.optString("uri", "");
        if (uriString.isEmpty()) { fail(id, "No file supplied"); return; }
        final Uri uri = Uri.parse(uriString);
        io.execute(() -> {
            try {
                String name = FileStore.meta(MainActivity.this, uri).optString("name", "document");
                DocParser.Result r = DocParser.fromUri(MainActivity.this, uri, name);
                JSONObject d = new JSONObject();
                d.put("text", r.text == null ? "" : r.text);
                d.put("pages", r.pages);
                if (r.error != null) d.put("error", r.error);
                sendOk(id, d);
            } catch (Throwable e) {
                fail(id, e.getMessage() == null ? "Could not read the file" : e.getMessage());
            }
        });
    }

    private void importFile(String id, JSONObject p) {
        String uriString = p.optString("uri", "");
        String rel = p.optString("relPath", "");
        if (uriString.isEmpty() || rel.isEmpty()) { fail(id, "Missing file or path"); return; }
        final Uri uri = Uri.parse(uriString);
        io.execute(() -> {
            try {
                JSONObject d = FileStore.importUri(MainActivity.this, uri, rel);
                sendOk(id, d);
            } catch (Exception e) {
                fail(id, e.getMessage() == null ? "Could not file that document" : e.getMessage());
            }
        });
    }

    private void openFile(String id, JSONObject p) {
        try {
            String rel = p.optString("relPath", "");
            String mime = p.optString("mime", "application/octet-stream");
            File f = FileStore.resolve(this, rel);
            if (!f.exists()) throw new Exception("The paper is no longer in the archive");
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.setClipData(ClipData.newRawUri("Legal Jarvis paper", uri));
            startActivity(i);
            sendOk(id, new JSONObject());
        } catch (Exception e) {
            fail(id, e.getMessage());
        }
    }

    private void shareFile(String id, JSONObject p) {
        try {
            String rel = p.optString("relPath", "");
            String mime = p.optString("mime", "application/octet-stream");
            File f = FileStore.resolve(this, rel);
            if (!f.exists()) throw new Exception("The paper is no longer in the archive");
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri("Legal Jarvis paper", uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(send, "Share paper"));
            sendOk(id, new JSONObject());
        } catch (Exception e) {
            fail(id, e.getMessage());
        }
    }

    private void moveFile(String id, JSONObject p) {
        final String from = p.optString("from", "");
        final String to = p.optString("to", "");
        io.execute(() -> {
            try {
                sendOk(id, FileStore.move(MainActivity.this, from, to));
            } catch (Exception e) {
                fail(id, e.getMessage());
            }
        });
    }

    private void deleteFile(String id, JSONObject p) {
        final String rel = p.optString("relPath", "");
        io.execute(() -> {
            try {
                FileStore.delete(MainActivity.this, rel);
                sendOk(id, new JSONObject());
            } catch (Exception e) {
                fail(id, e.getMessage());
            }
        });
    }

    private void readFile(String id, JSONObject p) {
        final String rel = p.optString("relPath", "");
        io.execute(() -> {
            try {
                byte[] bytes = FileStore.readBytes(MainActivity.this, rel, 20 * 1024 * 1024);
                JSONObject d = new JSONObject();
                d.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                sendOk(id, d);
            } catch (Exception e) {
                fail(id, e.getMessage());
            }
        });
    }

    private void renderPdf(String id, JSONObject p) {
        final String rel = p.optString("relPath", "");
        final int page = Math.max(1, p.optInt("page", 1));
        final int width = Math.max(320, Math.min(1800, p.optInt("width", 1200)));
        io.execute(() -> {
            try {
                File f = FileStore.resolve(MainActivity.this, rel);
                try (PDDocument doc = PDDocument.load(f)) {
                    int total = doc.getNumberOfPages();
                    if (total < 1) throw new Exception("This PDF has no pages");
                    int pn = Math.min(page, total);
                    PDFRenderer renderer = new PDFRenderer(doc);
                    Bitmap bmp = renderer.renderImageWithDPI(pn - 1, 96, ImageType.RGB);
                    if (bmp.getWidth() > width) {
                        int h = (int) (bmp.getHeight() * (width / (float) bmp.getWidth()));
                        Bitmap scaled = Bitmap.createScaledBitmap(bmp, width, h, true);
                        if (scaled != bmp) bmp.recycle();
                        bmp = scaled;
                    }
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    bmp.compress(Bitmap.CompressFormat.PNG, 100, bos);
                    bmp.recycle();
                    JSONObject d = new JSONObject();
                    d.put("dataUrl", "data:image/png;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
                    d.put("page", pn);
                    d.put("pages", total);
                    sendOk(id, d);
                }
            } catch (Throwable e) {
                fail(id, e.getMessage() == null ? "Could not render this PDF" : e.getMessage());
            }
        });
    }

    private void exportArchive(String id) {
        io.execute(() -> {
            try {
                File zip = FileStore.zipArchive(MainActivity.this);
                main.post(() -> {
                    try {
                        Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", zip);
                        Intent send = new Intent(Intent.ACTION_SEND);
                        send.setType("application/zip");
                        send.putExtra(Intent.EXTRA_STREAM, uri);
                        send.setClipData(ClipData.newRawUri("Legal Jarvis archive", uri));
                        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(send, "Export chamber archive"));
                        sendOk(id, new JSONObject());
                    } catch (Exception e) {
                        fail(id, e.getMessage());
                    }
                });
            } catch (Exception e) {
                fail(id, e.getMessage());
            }
        });
    }

    private void openArchiveFolder(String id) {
        try {
            String path = FileStore.root(this).getAbsolutePath();
            Toast.makeText(this, "Archive: " + path, Toast.LENGTH_LONG).show();
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
            JSONObject d = new JSONObject();
            d.put("path", path);
            sendOk(id, d);
        } catch (Exception e) {
            fail(id, e.getMessage());
        }
    }

    /* ============================================================
       Alarms & notifications
       ============================================================ */
    private void scheduleAlarm(String id, JSONObject p) {
        try {
            String alarmId = p.optString("id", "");
            long at = p.optLong("at", 0);
            String title = p.optString("title", "Chamber reminder");
            String body = p.optString("body", "Legal Jarvis");
            String kind = p.optString("kind", "reminder");
            if (alarmId.isEmpty() || at <= 0) throw new Exception("Invalid alarm");
            AlarmScheduler.schedule(this, alarmId, at, title, body, kind);
            sendOk(id, new JSONObject());
        } catch (Exception e) {
            fail(id, e.getMessage());
        }
    }

    private void cancelAlarm(String id, JSONObject p) {
        try {
            AlarmScheduler.cancel(this, p.optString("id", ""));
            sendOk(id, new JSONObject());
        } catch (Exception e) {
            fail(id, e.getMessage());
        }
    }

    private void setDailyBrief(String id, JSONObject p) {
        try {
            AlarmScheduler.setDaily(this, p.optString("morning", "08:30"),
                    p.optString("evening", "19:30"), p.optBoolean("enabled", true));
            sendOk(id, new JSONObject());
        } catch (Exception e) {
            fail(id, e.getMessage());
        }
    }

    private void notifyNow(String id, JSONObject p) {
        try {
            Notifier.show(this, (int) (System.currentTimeMillis() % 100000),
                    p.optString("title", "Legal Jarvis"),
                    p.optString("body", "All systems nominal, Sir."),
                    p.optString("kind", "reminder"),
                    Notifier.openApp(this, null, 77));
            sendOk(id, new JSONObject());
        } catch (Exception e) {
            fail(id, e.getMessage());
        }
    }

    private void openTtsSettings(String id) {
        try {
            startActivity(new Intent("com.android.settings.TTS_SETTINGS"));
        } catch (Exception e) {
            try { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
            catch (Exception ignored) {}
        }
        sendOk(id, new JSONObject());
    }

    /* ============================================================
       Intents: shares and briefing deep links
       ============================================================ */
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String brief = intent.getStringExtra("brief");
        if (brief != null) {
            final String kind = brief;
            afterReady(() -> {
                try {
                    JSONObject d = new JSONObject();
                    d.put("kind", kind);
                    emit("openBrief", d);
                } catch (Exception ignored) {}
            });
        }
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = getIntentUri(intent);
            if (u != null) queueShare(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (uris != null) for (Uri u : uris) queueShare(u);
        } else if (Intent.ACTION_VIEW.equals(action)) {
            Uri u = intent.getData();
            if (u != null) queueShare(u);
        }
    }

    private Uri getIntentUri(Intent intent) {
        try {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM);
        } catch (Exception e) {
            return null;
        }
    }

    private void queueShare(Uri uri) {
        if (uri == null) return;
        for (JSONObject o : shareQueue) {
            if (uri.toString().equals(o.optString("uri"))) return;
        }
        try {
            JSONObject meta = FileStore.meta(this, uri);
            if (!FileStore.supported(meta.optString("name"), meta.optString("mime"))) return;
            shareQueue.add(meta);
            takeRead(uri);
            afterReady(this::flushShares);
        } catch (Exception ignored) {}
    }

    private void flushShares() {
        if (!pageReady || shareQueue.isEmpty()) return;
        try {
            JSONArray arr = new JSONArray();
            for (JSONObject o : shareQueue) arr.put(o);
            shareQueue.clear();
            JSONObject d = new JSONObject();
            d.put("files", arr);
            emit("share", d);
        } catch (Exception ignored) {}
    }

    private void afterReady(Runnable r) {
        if (pageReady) main.post(r);
        else afterPage.add(r);
    }

    /* ============================================================
       Bridge plumbing
       ============================================================ */
    private void sendOk(String id, JSONObject data) {
        if (id == null || id.isEmpty()) return;
        try {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("ok", true);
            if (data != null) o.put("data", data);
            dispatch(o);
        } catch (Exception ignored) {}
    }

    private void fail(String id, String error) {
        if (id == null || id.isEmpty()) return;
        try {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("ok", false);
            o.put("error", error == null ? "Error" : error);
            dispatch(o);
        } catch (Exception ignored) {}
    }

    private void emit(String event, JSONObject data) {
        try {
            JSONObject o = new JSONObject();
            o.put("event", event);
            o.put("data", data == null ? new JSONObject() : data);
            dispatch(o);
        } catch (Exception ignored) {}
    }

    private void dispatch(JSONObject payload) {
        if (webView == null) return;
        final String json = payload.toString();
        main.post(() -> {
            try {
                webView.evaluateJavascript(
                        "window.JarvisNative&&window.JarvisNative.dispatch(" + JSONObject.quote(json) + ");",
                        null);
            } catch (Exception ignored) {}
        });
    }

    /* ============================================================
       Lifecycle
       ============================================================ */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        afterReady(() -> emit("resume", new JSONObject()));
    }

    @Override
    protected void onPause() {
        super.onPause();
        try { stopRecognition(); } catch (Exception ignored) {}
        try { stopSpeaking(""); } catch (Exception ignored) {}
    }

    @Override
    protected void onDestroy() {
        try { stopRecognition(); } catch (Exception ignored) {}
        try { if (tts != null) { tts.stop(); tts.shutdown(); } } catch (Exception ignored) {}
        try { if (webView != null) webView.destroy(); } catch (Exception ignored) {}
        io.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) { finish(); return; }
        webView.evaluateJavascript(
                "(function(){try{return window.App?App.handleBack():false}catch(e){return false}})()",
                value -> {
                    if (!"true".equals(value)) finish();
                });
    }

    private static double clamp(double v, double min, double max) {
        return Math.max(min, Math.min(max, v));
    }
}
