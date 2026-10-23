package com.legaljarvis.chamber;

import android.content.Context;
import android.net.Uri;
import android.util.Xml;

import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.text.PDFTextStripper;

import org.xmlpull.v1.XmlPullParser;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Extracts searchable text from PDF, DOCX, TXT and RTF — all on the device. */
final class DocParser {
    private DocParser() {}

    static final int MAX_CHARS = 300_000;

    static class Result {
        String text = "";
        int pages = 0;
        String error = null;
    }

    static Result fromUri(Context c, Uri uri, String displayName) {
        return fromUri(c, uri, displayName, null);
    }

    static Result fromUri(Context c, Uri uri, String displayName, String mime) {
        Result r = new Result();
        String name = displayName;
        if (name == null) name = "document";
        String ext = FileStore.extension(name);
        if (ext.isEmpty() && mime != null) {
            String m = mime.toLowerCase(java.util.Locale.ROOT);
            if (m.contains("pdf")) ext = "pdf";
            else if (m.contains("wordprocessingml")) ext = "docx";
            else if (m.contains("msword")) ext = "doc";
            else if (m.equals("text/plain")) ext = "txt";
            else if (m.contains("rtf")) ext = "rtf";
        }
        try (InputStream in = c.getContentResolver().openInputStream(uri)) {
            if (in == null) { r.error = "The file could not be opened"; return r; }
            switch (ext) {
                case "pdf":
                    return pdf(in);
                case "docx":
                    r.text = docx(in);
                    return r;
                case "doc":
                    r.text = legacyDoc(in);
                    return r;
                case "txt":
                    r.text = plain(in);
                    return r;
                case "rtf":
                    r.text = rtf(plain(in));
                    return r;
                default:
                    r.text = "";
                    return r;
            }
        } catch (Throwable t) {
            r.error = t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
            return r;
        }
    }

    private static Result pdf(InputStream in) {
        Result r = new Result();
        try {
            byte[] bytes = readAll(in, 80 * 1024 * 1024);
            try (PDDocument doc = PDDocument.load(bytes)) {
                r.pages = doc.getNumberOfPages();
                PDFTextStripper stripper = new PDFTextStripper();
                stripper.setSortByPosition(true);
                stripper.setLineSeparator("\n");
                String text = stripper.getText(doc);
                r.text = clean(cap(text));
            }
        } catch (Throwable t) {
            r.error = "This PDF could not be read: " + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
        }
        return r;
    }

    private static String docx(InputStream in) {
        try (ZipInputStream zis = new ZipInputStream(in)) {
            ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                if ("word/document.xml".equals(e.getName())) {
                    return clean(cap(parseWordXml(zis)));
                }
                if (e.getName().startsWith("word/") && !e.isDirectory()) {
                    byte[] b = new byte[1024];
                    while (zis.read(b) > 0) { /* skip */ }
                }
            }
        } catch (Exception ignored) {}
        return "";
    }

    private static String parseWordXml(InputStream in) throws Exception {
        XmlPullParser p = Xml.newPullParser();
        p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false);
        p.setInput(in, "UTF-8");
        StringBuilder sb = new StringBuilder();
        boolean inText = false;
        int ev = p.getEventType();
        while (ev != XmlPullParser.END_DOCUMENT && sb.length() < MAX_CHARS) {
            if (ev == XmlPullParser.START_TAG) {
                String n = p.getName();
                if (local(n).equals("t")) inText = true;
                else if (local(n).equals("tab")) sb.append('\t');
                else if (local(n).equals("br") || local(n).equals("cr")) sb.append('\n');
            } else if (ev == XmlPullParser.TEXT && inText) {
                sb.append(p.getText());
            } else if (ev == XmlPullParser.END_TAG) {
                String n = local(p.getName());
                if (n.equals("t")) inText = false;
                else if (n.equals("p")) sb.append('\n');
            }
            ev = p.next();
        }
        return sb.toString();
    }

    private static String local(String n) {
        if (n == null) return "";
        int i = n.indexOf(':');
        return i >= 0 ? n.substring(i + 1) : n;
    }

    private static String legacyDoc(InputStream in) {
        try {
            byte[] bytes = readAll(in, 20 * 1024 * 1024);
            String s = new String(bytes, StandardCharsets.ISO_8859_1);
            StringBuilder sb = new StringBuilder();
            int run = 0;
            for (int i = 0; i < s.length() && sb.length() < MAX_CHARS; i++) {
                char c = s.charAt(i);
                if ((c >= 32 && c <= 126) || c == '\n' || c == '\t' || (c >= 0x0900 && c <= 0x097F)) {
                    sb.append(c);
                    run++;
                } else {
                    if (run > 3) sb.append('\n');
                    run = 0;
                }
            }
            return clean(cap(sb.toString()));
        } catch (Exception e) {
            return "";
        }
    }

    private static String plain(InputStream in) {
        try {
            byte[] bytes = readAll(in, 10 * 1024 * 1024);
            String s = new String(bytes, StandardCharsets.UTF_8);
            if (s.indexOf('\uFFFD') > 10) s = new String(bytes, StandardCharsets.ISO_8859_1);
            return cap(s);
        } catch (Exception e) {
            return "";
        }
    }

    private static String rtf(String s) {
        if (s == null || !s.startsWith("{\\rtf")) return s == null ? "" : s;
        StringBuilder out = new StringBuilder();
        boolean skip = false;
        for (int i = 0; i < s.length() && out.length() < MAX_CHARS; i++) {
            char c = s.charAt(i);
            if (c == '{') skip = false;
            if (c == '\\') {
                int j = i + 1;
                while (j < s.length() && Character.isLetter(s.charAt(j))) j++;
                String word = s.substring(i + 1, j);
                if (word.equals("par") || word.equals("line")) out.append('\n');
                if (word.equals("tab")) out.append('\t');
                int k = j;
                while (k < s.length() && (Character.isDigit(s.charAt(k)) || s.charAt(k) == ' ')) k++;
                i = k - 1;
                continue;
            }
            if (c == '}' || c == '\r') continue;
            if (c == '\n') { out.append('\n'); continue; }
            if (!skip) out.append(c);
        }
        return clean(cap(out.toString()));
    }

    private static byte[] readAll(InputStream in, int max) throws Exception {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[32 * 1024];
        int n, total = 0;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > max) throw new Exception("File is too large to read");
            bos.write(buf, 0, n);
        }
        return bos.toByteArray();
    }

    private static String cap(String s) {
        if (s == null) return "";
        if (s.length() > MAX_CHARS) return s.substring(0, MAX_CHARS);
        return s;
    }

    private static String clean(String s) {
        if (s == null) return "";
        return s.replace('\u0000', ' ')
                .replaceAll("[ \\t]+\\n", "\n")
                .replaceAll("\\n{3,}", "\n\n")
                .trim();
    }
}
