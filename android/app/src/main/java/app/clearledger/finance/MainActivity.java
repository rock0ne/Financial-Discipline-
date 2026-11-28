package app.clearledger.finance;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentSavePlugin.class);
        registerPlugin(StatementFolderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
