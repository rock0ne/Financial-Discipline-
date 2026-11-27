package app.clearledger.finance;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
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
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Saves a user-generated PDF or CSV only after the user chooses a document location. */
@CapacitorPlugin(name = "DocumentSave")
public class DocumentSavePlugin extends Plugin {
    private static final int MAX_BASE64_LENGTH = 20_000_000;
    private static final int MAX_DOCUMENT_BYTES = 15_000_000;

    @PluginMethod
    public void saveDocument(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType");
        String dataBase64 = call.getString("dataBase64");
        boolean isPdf = "application/pdf".equals(mimeType) &&
                fileName != null && fileName.matches("[A-Za-z0-9._-]{1,128}\\.pdf");
        boolean isCsv = "text/csv".equals(mimeType) &&
                fileName != null && fileName.matches("[A-Za-z0-9._-]{1,128}\\.csv");
        if (!isPdf && !isCsv) {
            call.reject("Unsupported document type or filename");
            return;
        }
        if (dataBase64 == null || dataBase64.isEmpty() || dataBase64.length() > MAX_BASE64_LENGTH) {
            call.reject("Document is empty or too large for export");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        startActivityForResult(call, intent, "onDestinationChosen");
    }

    @ActivityCallback
    private void onDestinationChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            JSObject response = new JSObject();
            response.put("status", "cancelled");
            call.resolve(response);
            return;
        }

        Intent data = result.getData();
        Uri destination = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || destination == null || !"content".equals(destination.getScheme())) {
            call.reject("No writable document destination was returned");
            return;
        }

        try {
            byte[] document = Base64.decode(call.getString("dataBase64"), Base64.DEFAULT);
            boolean isPdf = "application/pdf".equals(call.getString("mimeType"));
            if (document.length == 0 || document.length > MAX_DOCUMENT_BYTES ||
                    (isPdf && (document.length < 5 ||
                    !"%PDF-".equals(new String(document, 0, 5, StandardCharsets.US_ASCII))))) {
                call.reject("Invalid document data");
                return;
            }
            try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                if (output == null) throw new IOException("Document provider returned no output stream");
                output.write(document);
                output.flush();
            }

            JSObject response = new JSObject();
            response.put("status", "saved");
            response.put("fileName", queryDisplayName(destination, call.getString("fileName")));
            call.resolve(response);
        } catch (IllegalArgumentException | IOException | SecurityException error) {
            // The provider may have left a partial document. Do not claim that a save succeeded.
            call.reject("Could not write the selected document; check the chosen location for a partial file");
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
