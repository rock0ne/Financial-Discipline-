package app.clearledger.finance;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/** One-shot, read-only access to a directory explicitly chosen in Android's system picker. */
@CapacitorPlugin(name = "StatementFolder")
public class StatementFolderPlugin extends Plugin {
    private static final int MAX_ENTRIES = 256;
    private static final int MAX_FILES = 60;
    private static final int MAX_DEPTH = 3;
    private static final int MAX_FILE_BYTES = 10_000_000;
    private static final int MAX_TOTAL_BYTES = 30_000_000;

    private static final class PickedFile {
        final DocumentFile document;
        final String name;
        final String displayPath;
        final long reportedSize;

        PickedFile(DocumentFile document, String name, String displayPath, long reportedSize) {
            this.document = document;
            this.name = name;
            this.displayPath = displayPath;
            this.reportedSize = reportedSize;
        }
    }

    private final Object selectionLock = new Object();
    private final Map<Integer, PickedFile> selected = new HashMap<>();
    private String selectionToken;
    private Uri treeUri;
    private int readBytes;
    private boolean pickerOpen;

    @PluginMethod
    public void pickFolder(PluginCall call) {
        synchronized (selectionLock) {
            if (pickerOpen) {
                call.reject("A folder picker is already open");
                return;
            }
            pickerOpen = true;
        }
        clearSelection();
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "onFolderChosen");
    }

    @ActivityCallback
    private void onFolderChosen(PluginCall call, ActivityResult result) {
        synchronized (selectionLock) {
            pickerOpen = false;
        }
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            JSObject response = new JSObject();
            response.put("status", "cancelled");
            call.resolve(response);
            return;
        }
        Intent data = result.getData();
        Uri granted = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || granted == null ||
                !"content".equals(granted.getScheme())) {
            call.reject("No readable folder was selected");
            return;
        }

        execute(() -> {
            try {
                DocumentFile root = DocumentFile.fromTreeUri(getContext(), granted);
                if (root == null || !root.isDirectory() || !root.canRead()) {
                    throw new IOException("The selected folder is not readable");
                }
                List<PickedFile> found = new ArrayList<>();
                int[] counts = {0, 0}; // all entries visited, unsupported files ignored
                String rootName = cleanName(root.getName());
                if (rootName.length() > 160) throw new IOException("Folder name too long");
                collect(root, rootName, 0, found, counts);
                found.sort(Comparator.comparing(item -> item.displayPath));
                long knownBytes = 0;
                for (PickedFile item : found) knownBytes += item.reportedSize;
                if (knownBytes > MAX_TOTAL_BYTES) {
                    throw new IOException("Folder size limit exceeded");
                }

                String token = UUID.randomUUID().toString();
                JSArray files = new JSArray();
                synchronized (selectionLock) {
                    selectionToken = token;
                    treeUri = granted;
                    readBytes = 0;
                    for (int i = 0; i < found.size(); i++) {
                        PickedFile item = found.get(i);
                        selected.put(i, item);
                        JSObject entry = new JSObject();
                        entry.put("id", i);
                        entry.put("name", item.name);
                        entry.put("displayPath", item.displayPath);
                        entry.put("size", item.reportedSize);
                        files.put(entry);
                    }
                }
                JSObject response = new JSObject();
                response.put("status", "selected");
                response.put("token", token);
                response.put("ignoredCount", counts[1]);
                response.put("files", files);
                call.resolve(response);
            } catch (IOException | RuntimeException error) {
                clearSelection();
                call.reject("Folder could not be read safely; choose a smaller statements folder");
            }
        });
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String token = call.getString("token");
        Integer id = call.getInt("id");
        PickedFile item;
        synchronized (selectionLock) {
            item = token != null && token.equals(selectionToken) && id != null
                    ? selected.get(id) : null;
        }
        if (item == null) {
            call.reject("Folder selection has expired");
            return;
        }
        execute(() -> {
            try {
                byte[] bytes = readBounded(item.document);
                if (bytes.length == 0) throw new IOException("Empty statement");
                synchronized (selectionLock) {
                    if (!token.equals(selectionToken) || readBytes + bytes.length > MAX_TOTAL_BYTES) {
                        throw new IOException("Folder selection exceeded the size limit");
                    }
                    readBytes += bytes.length;
                }
                JSObject response = new JSObject();
                response.put("dataBase64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                call.resolve(response);
            } catch (IOException | RuntimeException error) {
                call.reject("A selected statement could not be read safely");
            }
        });
    }

    @PluginMethod
    public void release(PluginCall call) {
        String token = call.getString("token");
        boolean matches;
        synchronized (selectionLock) {
            matches = token != null && token.equals(selectionToken);
        }
        boolean released = matches && clearSelection();
        JSObject response = new JSObject();
        response.put("released", released);
        call.resolve(response);
    }

    @Override
    protected void handleOnDestroy() {
        clearSelection();
    }

    private boolean clearSelection() {
        Uri previous;
        synchronized (selectionLock) {
            previous = treeUri;
            treeUri = null;
            selectionToken = null;
            selected.clear();
            readBytes = 0;
        }
        if (previous != null) {
            try {
                getContext().revokeUriPermission(previous, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (RuntimeException error) {
                // No persistable grant was ever taken; expiry remains tied to this activity.
                return false;
            }
        }
        return true;
    }

    private void collect(DocumentFile folder, String path, int depth,
            List<PickedFile> found, int[] counts) throws IOException {
        if (depth > MAX_DEPTH) throw new IOException("Folder nesting limit exceeded");
        DocumentFile[] children = folder.listFiles();
        Arrays.sort(children, Comparator.comparing(child -> cleanName(child.getName())));
        for (DocumentFile child : children) {
            if (++counts[0] > MAX_ENTRIES) throw new IOException("Folder entry limit exceeded");
            String name = cleanName(child.getName());
            if (name.length() > 160) throw new IOException("Document name too long");
            if (child.isDirectory()) {
                collect(child, path + "/" + name, depth + 1, found, counts);
                continue;
            }
            if (!child.isFile() || !supported(name)) {
                counts[1]++;
                continue;
            }
            if (!child.canRead() || found.size() >= MAX_FILES) {
                throw new IOException("Folder file limit exceeded");
            }
            long size = child.length();
            if (size < 0 || size > MAX_FILE_BYTES) throw new IOException("Statement file too large");
            found.add(new PickedFile(child, name, path + "/" + name, size));
        }
    }

    private byte[] readBounded(DocumentFile file) throws IOException {
        try (InputStream input = getContext().getContentResolver().openInputStream(file.getUri());
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IOException("No input stream");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (output.size() + read > MAX_FILE_BYTES) throw new IOException("Statement too large");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static boolean supported(String name) {
        if (name.startsWith(".")) return false;
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".pdf") || lower.endsWith(".csv") ||
                lower.endsWith(".tsv") || lower.endsWith(".ofx") ||
                lower.endsWith(".qfx") || lower.endsWith(".json");
    }

    private static String cleanName(String name) {
        return name == null || name.isEmpty() ? "Selected folder" :
                name.replace('/', '_').replace('\\', '_');
    }
}
