package io.github.benrlc18.atvmconnect

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Écran unique : association avec ATV Manager, puis état de la connexion. */
class MainActivity : Activity() {

    private lateinit var prefs: Prefs
    private val main = Handler(Looper.getMainLooper())

    private lateinit var pairGroup: View
    private lateinit var statusGroup: View
    private lateinit var server: EditText
    private lateinit var code: EditText
    private lateinit var pairButton: Button
    private lateinit var error: TextView
    private lateinit var serverLine: TextView
    private lateinit var connLine: TextView
    private lateinit var adbLine: TextView
    private lateinit var hint: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)

        pairGroup = findViewById(R.id.pair_group)
        statusGroup = findViewById(R.id.status_group)
        server = findViewById(R.id.server)
        code = findViewById(R.id.code)
        pairButton = findViewById(R.id.pair)
        error = findViewById(R.id.error)
        serverLine = findViewById(R.id.server_line)
        connLine = findViewById(R.id.conn_line)
        adbLine = findViewById(R.id.adb_line)
        hint = findViewById(R.id.hint)

        server.setText(prefs.server.removePrefix("https://"))
        pairButton.setOnClickListener { pair() }
        code.setOnEditorActionListener { _, actionId, _ -> if (actionId == EditorInfo.IME_ACTION_DONE) { pair(); true } else false }
        findViewById<Button>(R.id.unpair).setOnClickListener {
            AgentService.stop(this)
            prefs.clearPairing()
            refresh()
        }
    }

    override fun onResume() {
        super.onResume()
        if (prefs.paired) AgentService.start(this)
        refresh()
        main.postDelayed(ticker, 1000)
    }

    override fun onPause() {
        main.removeCallbacks(ticker)
        super.onPause()
    }

    private val ticker = object : Runnable {
        override fun run() { refresh(); main.postDelayed(this, 1000) }
    }

    private fun refresh() {
        val paired = prefs.paired
        pairGroup.visibility = if (paired) View.GONE else View.VISIBLE
        statusGroup.visibility = if (paired) View.VISIBLE else View.GONE
        if (!paired) {
            val s = AgentService.status
            if (s.server == "revoked" && error.text.isEmpty()) { error.text = s.message; error.visibility = View.VISIBLE }
            return
        }
        val s = AgentService.status
        serverLine.text = prefs.server.removePrefix("https://")
        connLine.text = when (s.server) {
            "ok" -> "● Connectée à ATV Manager"
            "connexion" -> "○ Connexion en cours…"
            else -> "○ Hors ligne : nouvel essai automatique"
        }
        adbLine.text = when (s.adb) {
            "ok" -> "● Débogage autorisé"
            "unauthorized" -> "○ Débogage à autoriser"
            "unavailable" -> "○ Débogage réseau désactivé"
            else -> "○ Vérification du débogage…"
        }
        hint.text = when {
            s.adb != "ok" && s.adbMessage.isNotEmpty() -> s.adbMessage
            s.server == "ok" && s.adb == "ok" -> "Tout est prêt. Tu peux fermer cette appli : la TV reste reliée à ATV Manager, même après un redémarrage."
            else -> s.message
        }
    }

    private fun pair() {
        val url = Prefs.normalizeServer(server.text.toString())
        val c = code.text.toString().filter { it.isDigit() }
        if (url.isEmpty() || c.length != 6) {
            showError("Entre l'adresse du serveur et le code à 6 chiffres affiché dans ATV Manager.")
            return
        }
        pairButton.isEnabled = false
        pairButton.text = "Association…"
        error.visibility = View.GONE
        thread {
            val result = try {
                val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
                val body = JSONObject().put("code", c).put("name", "${Build.MANUFACTURER} ${Build.MODEL}").toString()
                    .toRequestBody("application/json".toMediaType())
                client.newCall(Request.Builder().url("$url/api/agent/pair").post(body).build()).execute().use { res ->
                    val json = JSONObject(res.body?.string() ?: "{}")
                    if (res.isSuccessful) {
                        prefs.server = url
                        prefs.agentId = json.getString("agentId")
                        prefs.token = json.getString("token")
                        null
                    } else json.optString("error", "Erreur ${res.code}")
                }
            } catch (e: Exception) {
                "Impossible de joindre $url. Vérifie l'adresse et la connexion internet de la TV."
            }
            main.post {
                pairButton.isEnabled = true
                pairButton.text = getString(R.string.pair)
                if (result == null) {
                    code.setText("")
                    AgentService.start(this)
                    refresh()
                } else showError(result)
            }
        }
    }

    private fun showError(msg: String) {
        error.text = msg
        error.visibility = View.VISIBLE
    }
}
