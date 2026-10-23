package com.legaljarvis.chamber;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * The chamber archive: every imported paper is copied into
 *   &lt;external files&gt;/LegalJarvis/Archive/&lt;court&gt;/&lt;case&gt;/&lt;type&gt;/&lt;file&gt;
 * Nothing leaves the tablet.
 */
final class FileStore {
    private FileStore() {}

    static File root(Context c) {
        File base = c.getExternalFilesDir(null);
        if (base == null) base = c.getFilesDir();
        File dir = new File(base, "LegalJarvis/Archive");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    static File resolve(Context c, String relPath) throws IOException {
        if (relPath == null || relPath.trim().isEmpty()) throw new IOException("No path supplied");
        String rel = relPath.replace('\\', '/');
        while (rel.startsWith("/")) rel = rel.substring(1);
        File root = root(c);
        File target = new File(root, rel);
        String rootCanon = root.getCanonicalPath();
        String targetCanon = target.getCanonicalPath();
        if (!targetCanon.equals(rootCanon) && !targetCanon.startsWith(rootCanon + File.separator)) {
            throw new IOException("Path outside the archive");
        }
        return target;
    }

    static String relative(Context c, File f) throws IOException {
        return root(c).toPath().relativize(f.toPath()).toString().replace('\\', '/');
    }

    static boolean supported(String name, String mime) {
        String n = name == null ? "" : name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".pdf") || n.endsWith(".doc") || n.endsWith(".docx") || n.endsWith(".txt")
                || n.endsWith(".rtf") || n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg")
                || n.endsWith(".webp")) return true;
        String m = mime == null ? "" : mime.toLowerCase(Locale.ROOT);
        return m.startsWith("image/") || m.equals("application/pdf") || m.contains("word") || m.startsWith("text/");
    }

    static String extension(String name) {
        int i = name == null ? -1 : name.lastIndexOf('.');
        return i >= 0 ? name.substring(i + 1).toLowerCase(Locale.ROOT) : "";
    }

    static String mimeFor(String ext) {
        String e = ext == null ? "" : ext.toLowerCase(Locale.ROOT);
        switch (e) {
            case "pdf": return "application/pdf";
            case "doc": return "application/msword";
            case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "txt": return "text/plain";
            case "rtf": return "application/rtf";
            case "png": return "image/png";
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            default: {
                String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(e);
                return m == null ? "application/octet-stream" : m;
            }
        }
    }

    /** Metadata for a user-selected content URI. */
    static JSONObject meta(Context c, Uri uri) {
        JSONObject o = new JSONObject();
        String name = null;
        long size = -1;
        long modified = System.currentTimeMillis();
        String mime = null;
        try { mime = c.getContentResolver().getType(uri); } catch (Exception ignored) {}
        try (Cursor cur = c.getContentResolver().query(uri, null, null, null, null)) {
            if (cur != null) {
                int ni = cur.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int si = cur.getColumnIndex(OpenableColumns.SIZE);
                int li = cur.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                if (cur.moveToFirst()) {
                    if (ni >= 0) name = cur.getString(ni);
                    if (si >= 0) size = cur.getLong(si);
                    if (li >= 0) modified = cur.getLong(li);
                }
            }
        } catch (Exception ignored) {}
        if (name == null || name.trim().isEmpty()) {
            name = uri.getLastPathSegment() == null ? "Document" : uri.getLastPathSegment();
            if (name.contains("/")) name = name.substring(name.lastIndexOf('/') + 1);
        }
        try {
            o.put("uri", uri.toString());
            o.put("name", name);
            o.put("size", size);
            o.put("lastModified", modified);
            o.put("mime", mime == null ? mimeFor(extension(name)) : mime);
        } catch (Exception ignored) {}
        return o;
    }

    /** Copy a content URI into the archive at the requested relative path. */
    static JSONObject importUri(Context c, Uri uri, String relPath) throws Exception {
        File dest = resolve(c, relPath);
        File dir = dest.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) throw new IOException("Could not create the case folder");
        File target = unique(dest);
        ContentResolver cr = c.getContentResolver();
        InputStream in = cr.openInputStream(uri);
        if (in == null) throw new IOException("The selected file could not be opened");
        long copied;
        try (InputStream is = in; OutputStream os = new FileOutputStream(target)) {
            copied = copy(is, os);
        }
        if (copied == 0 && target.length() == 0) {
            target.delete();
            throw new IOException("The selected file was empty or inaccessible");
        }
        JSONObject o = new JSONObject();
        o.put("relPath", relative(c, target));
        o.put("size", target.length());
        return o;
    }

    private static File unique(File dest) {
        if (!dest.exists()) return dest;
        String name = dest.getName();
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 2; i < 1000; i++) {
            File f = new File(dest.getParentFile(), base + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
        return new File(dest.getParentFile(), base + "-" + System.currentTimeMillis() + ext);
    }

    static long copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        long total = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            total += n;
        }
        return total;
    }

    /** Recursively list supported documents in a SAF tree. */
    static List<JSONObject> scanTree(Context c, Uri treeUri) throws Exception {
        List<JSONObject> out = new ArrayList<>();
        String rootId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, rootId);
        walk(c, treeUri, children, "", out, 0);
        return out;
    }

    private static void walk(Context c, Uri treeUri, Uri children, String prefix, List<JSONObject> out, int depth) {
        if (depth > 8 || out.size() >= 2500) return;
        ContentResolver cr = c.getContentResolver();
        String[] cols = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED
        };
        Cursor cur = null;
        try {
            cur = cr.query(children, cols, null, null, null);
            if (cur == null) return;
            while (cur.moveToNext() && out.size() < 2500) {
                String docId = cur.getString(0);
                String name = cur.getString(1);
                String mime = cur.getString(2);
                long size = cur.isNull(3) ? -1 : cur.getLong(3);
                long modified = cur.isNull(4) ? System.currentTimeMillis() : cur.getLong(4);
                if (name == null) continue;
                if (name.startsWith(".")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    Uri sub = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
                    walk(c, treeUri, sub, prefix + name + "/", out, depth + 1);
                } else if (supported(name, mime)) {
                    JSONObject o = new JSONObject();
                    o.put("uri", DocumentsContract.buildDocumentUriUsingTree(treeUri, docId).toString());
                    o.put("name", name);
                    o.put("size", size);
                    o.put("lastModified", modified);
                    o.put("mime", mime);
                    o.put("relativePath", prefix + name);
                    out.add(o);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cur != null) try { cur.close(); } catch (Exception ignored) {}
        }
    }

    static String treeName(Context c, Uri treeUri) {
        try {
            String id = DocumentsContract.getTreeDocumentId(treeUri);
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
            try (Cursor cur = c.getContentResolver().query(doc,
                    new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                if (cur != null && cur.moveToFirst()) {
                    String n = cur.getString(0);
                    if (n != null && !n.isEmpty()) return n;
                }
            }
        } catch (Exception ignored) {}
        return "Linked folder";
    }

    static byte[] readBytes(Context c, String relPath, int max) throws Exception {
        File f = resolve(c, relPath);
        if (!f.exists()) throw new IOException("File not found");
        long len = f.length();
        if (len > max) throw new IOException("File too large");
        byte[] buf = new byte[(int) len];
        try (InputStream in = new FileInputStream(f)) {
            int off = 0, n;
            while (off < buf.length && (n = in.read(buf, off, buf.length - off)) > 0) off += n;
        }
        return buf;
    }

    static String readText(Context c, String relPath) throws Exception {
        return new String(readBytes(c, relPath, 20 * 1024 * 1024), "UTF-8");
    }

    static JSONObject move(Context c, String from, String to) throws Exception {
        File src = resolve(c, from);
        File dest = resolve(c, to);
        if (!src.exists()) throw new IOException("Source missing");
        File parent = dest.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        if (!src.renameTo(dest)) {
            try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dest)) {
                copy(in, out);
            }
            if (!src.delete()) throw new IOException("Could not remove the old copy");
        }
        JSONObject o = new JSONObject();
        o.put("relPath", relative(c, dest));
        o.put("size", dest.length());
        return o;
    }

    static void delete(Context c, String relPath) throws Exception {
        File f = resolve(c, relPath);
        if (f.exists()) f.delete();
        // tidy empty folders
        File parent = f.getParentFile();
        File root = root(c);
        while (parent != null && !parent.getCanonicalPath().equals(root.getCanonicalPath())) {
            String[] kids = parent.list();
            if (kids != null && kids.length == 0) parent.delete(); else break;
            parent = parent.getParentFile();
        }
    }

    /** Zip the archive into cache for sharing / backup. */
    static File zipArchive(Context c) throws Exception {
        File root = root(c);
        File out = new File(c.getCacheDir(), "LegalJarvis-Archive-" + System.currentTimeMillis() + ".zip");
        if (!root.exists()) {
            try (ZipOutputStream z = new ZipOutputStream(new FileOutputStream(out))) {
                z.putNextEntry(new ZipEntry("README.txt"));
                z.write("The Legal Jarvis archive is empty.".getBytes("UTF-8"));
                z.closeEntry();
            }
            return out;
        }
        try (ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(out))) {
            addDir(root, root, zos);
        }
        return out;
    }

    private static void addDir(File root, File dir, ZipOutputStream zos) throws IOException {
        File[] files = dir.listFiles();
        if (files == null) return;
        java.util.Arrays.sort(files);
        for (File f : files) {
            if (f.isDirectory()) {
                addDir(root, f, zos);
            } else {
                String rel = root.toPath().relativize(f.toPath()).toString().replace('\\', '/');
                ZipEntry e = new ZipEntry(rel);
                zos.putNextEntry(e);
                try (InputStream in = new FileInputStream(f)) {
                    copy(in, zos);
                }
                zos.closeEntry();
            }
        }
    }

    static JSONArray arrayOf(List<JSONObject> list) {
        JSONArray a = new JSONArray();
        for (JSONObject o : list) a.put(o);
        return a;
    }
}
