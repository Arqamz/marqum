package app.marqum

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(MarqumNativePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
