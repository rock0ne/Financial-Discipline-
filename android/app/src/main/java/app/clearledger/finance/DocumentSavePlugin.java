package app.clearledger.finance;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/** Saves a user-generated PDF, CSV or encrypted vault only after the user chooses a document location. */
@CapacitorPlugin(name = "DocumentSave")
public class DocumentSavePlugin extends Plugin {
    private static final int MAX_BASE64_LENGTH = 20_000_000;
    private static final int MAX_DOCUMENT_BYTES = 15_000_000;
    private static final long STAGE_TTL_MS = 60 * 60 * 1000L;

    @Override
    public void load() {
        cleanupStaleStages();
    }

    @PluginMethod
    public void prepareDocument(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType");
        String dataBase64 = call.getString("dataBase64");
        String kind = documentKind(fileName, mimeType);
        if (kind == null) {
            call.reject("Unsupported document type or filename");
            return;
        }
        if (dataBase64 == null || dataBase64.isEmpty() || dataBase64.length() > MAX_BASE64_LENGTH) {
            call.reject("Document is empty or too large for export");
            return;
        }

        File stage = null;
        try {
            byte[] document = Base64.decode(dataBase64, Base64.DEFAULT);
            if (document.length == 0 || document.length > MAX_DOCUMENT_BYTES ||
                    ("pdf".equals(kind) && (document.length < 5 ||
                    !"%PDF-".equals(new String(document, 0, 5, StandardCharsets.US_ASCII)))) ||
                    ("vault".equals(kind) && !isEncryptedVault(document))) {
                call.reject("Invalid document data");
                return;
            }

            cleanupStaleStages();
            String token = kind + "-" + UUID.randomUUID();
            stage = stageFile(token);
            try (FileOutputStream output = new FileOutputStream(stage)) {
                output.write(document);
                output.getFD().sync();
            }
            JSObject response = new JSObject();
            response.put("token", token);
            call.resolve(response);
        } catch (IllegalArgumentException | IOException error) {
            if (stage != null) stage.delete();
            call.reject("Could not prepare the document for export");
        }
    }

    @PluginMethod
    public void savePreparedDocument(PluginCall call) {
        String token = call.getString("token");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType");
        String kind = documentKind(fileName, mimeType);
        if (!isValidToken(token) || kind == null || !token.startsWith(kind + "-")) {
            call.reject("Invalid prepared export request");
            return;
        }
        File stage = stageFile(token);
        if (!stage.isFile() || stage.length() == 0 || stage.length() > MAX_DOCUMENT_BYTES) {
            call.reject("Prepared export is missing or expired");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        startActivityForResult(call, intent, "onDestinationChosen");
    }

    @PluginMethod
    public void discardDocument(PluginCall call) {
        String token = call.getString("token");
        if (!isValidToken(token)) {
            call.reject("Invalid prepared export token");
            return;
        }
        stageFile(token).delete();
        call.resolve();
    }

    @ActivityCallback
    private void onDestinationChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        String token = call.getString("token");
        if (!isValidToken(token)) {
            call.reject("Prepared export token was lost");
            return;
        }
        File stage = stageFile(token);
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            stage.delete();
            JSObject response = new JSObject();
            response.put("status", "cancelled");
            call.resolve(response);
            return;
        }

        Intent data = result.getData();
        Uri destination = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || destination == null || !"content".equals(destination.getScheme())) {
            stage.delete();
            call.reject("No writable document destination was returned");
            return;
        }

        try {
            if (!stage.isFile() || stage.length() == 0 || stage.length() > MAX_DOCUMENT_BYTES) {
                throw new IOException("Prepared export is missing or expired");
            }
            long expectedBytes = stage.length();
            long writtenBytes = 0;
            try (FileInputStream input = new FileInputStream(stage);
                 OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                if (output == null) throw new IOException("Document provider returned no output stream");
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    writtenBytes += read;
                }
                output.flush();
            }
            if (writtenBytes != expectedBytes) throw new IOException("Incomplete document write");

            JSObject response = new JSObject();
            response.put("status", "saved");
            response.put("fileName", queryDisplayName(destination, call.getString("fileName")));
            stage.delete();
            call.resolve(response);
        } catch (IllegalArgumentException | IOException | SecurityException error) {
            stage.delete();
            tryDeleteCreatedDestination(destination);
            call.reject("Could not write the selected document; check the chosen location for a partial file");
        }
    }

    private String documentKind(String fileName, String mimeType) {
        if (fileName == null || mimeType == null) return null;
        if ("application/pdf".equals(mimeType) &&
                fileName.matches("clearledger_[A-Za-z0-9._-]{1,128}\\.pdf")) return "pdf";
        if ("text/csv".equals(mimeType) &&
                fileName.matches("clearledger_[A-Za-z0-9._-]{1,128}\\.csv")) return "csv";
        if ("application/json".equals(mimeType) &&
                fileName.matches("clearledger_backup_\\d{4}-\\d{2}-\\d{2}\\.vault\\.json")) return "vault";
        return null;
    }

    private boolean isValidToken(String token) {
        return token != null && token.matches(
                "(pdf|csv|vault)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    }

    private File stageFile(String token) {
        return new File(getContext().getCacheDir(), "clearledger-export-" + token + ".tmp");
    }

    private void cleanupStaleStages() {
        File[] files = getContext().getCacheDir().listFiles();
        if (files == null) return;
        long now = System.currentTimeMillis();
        for (File file : files) {
            String name = file.getName();
            if (name.matches("clearledger-export-(pdf|csv|vault)-[0-9a-f-]{36}\\.tmp") &&
                    file.isFile() && now - file.lastModified() > STAGE_TTL_MS) {
                file.delete();
            }
        }
    }

    private void tryDeleteCreatedDestination(Uri destination) {
        try {
            DocumentsContract.deleteDocument(getContext().getContentResolver(), destination);
        } catch (Exception ignored) {
            // A remote document provider may not support deletion; caller is warned about a partial file.
        }
    }

    private boolean isEncryptedVault(byte[] bytes) {
        try {
            JSONObject value = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            return value.length() == 9 &&
                    "clearledger-e2ee-v1".equals(value.optString("format")) &&
                    "AES-256-GCM".equals(value.optString("cipher")) &&
                    "PBKDF2-SHA256".equals(value.optString("kdf")) &&
                    value.optInt("iterations") >= 100_000 &&
                    value.optInt("byteLength") > 0 &&
                    !value.optString("saltBase64").isEmpty() &&
                    !value.optString("ivBase64").isEmpty() &&
                    !value.optString("ciphertextBase64").isEmpty() &&
                    !value.optString("updatedAt").isEmpty();
        } catch (JSONException error) {
            return false;
        }
    }

    private String queryDisplayName(Uri uri, String fallback) {
        try (Cursor cursor = getContext().getContentResolver().query(
                uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String name = cursor.getString(column);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (RuntimeException ignored) {
            // A provider may omit display metadata even after a successful write.
        }
        return fallback;
    }
}
