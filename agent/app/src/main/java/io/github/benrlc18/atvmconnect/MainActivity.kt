package io.github.benrlc18.atvmconnect

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
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

/**
 * Écran unique, en 3 étapes :
 * 1. mode développeur, 2. débogage (l'appli ouvre le bon écran des paramètres et explique quoi faire),
 * 3. association avec le code affiché dans ATV Manager. Ensuite : état de la connexion.
 */
class MainActivity : Activity() {

    private lateinit var prefs: Prefs
    private val main = Handler(Looper.getMainLooper())

    private lateinit var setupGroup: View
    private lateinit var pairGroup: View
    private lateinit var statusGroup: View
    private lateinit var setupStep: TextView
    private lateinit var setupTitle: TextView
    private lateinit var setupText: TextView
    private lateinit var setupOpen: Button
    private lateinit var serverLabel: View
    private lateinit var server: EditText
    private lateinit var otherServer: Button
    private lateinit var pairStep: TextView
    private lateinit var intro: TextView
    private lateinit var code: EditText
    private lateinit var pairButton: Button
    private lateinit var error: TextView
    private lateinit var serverLine: TextView
    private lateinit var connLine: TextView
    private lateinit var adbLine: TextView
    private lateinit var hint: TextView
    private lateinit var openDev: Button

    private var skipSetup = false
    private var customServer = false
    private var shownStep = -1

    private val defaultServer: String get() = Prefs.normalizeServer(BuildConfig.DEFAULT_SERVER)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)

        setupGroup = findViewById(R.id.setup_group)
        pairGroup = findViewById(R.id.pair_group)
        statusGroup = findViewById(R.id.status_group)
        setupStep = findViewById(R.id.setup_step)
        setupTitle = findViewById(R.id.setup_title)
        setupText = findViewById(R.id.setup_text)
        setupOpen = findViewById(R.id.setup_open)
        serverLabel = findViewById(R.id.server_label)
        server = findViewById(R.id.server)
        otherServer = findViewById(R.id.other_server)
        pairStep = findViewById(R.id.pair_step)
        intro = findViewById(R.id.intro)
        code = findViewById(R.id.code)
        pairButton = findViewById(R.id.pair)
        error = findViewById(R.id.error)
        serverLine = findViewById(R.id.server_line)
        connLine = findViewById(R.id.conn_line)
        adbLine = findViewById(R.id.adb_line)
        hint = findViewById(R.id.hint)
        openDev = findViewById(R.id.open_dev)

        server.setText(prefs.server.ifEmpty { defaultServer }.removePrefix("https://"))
        pairButton.setOnClickListener { pair() }
        code.setOnEditorActionListener { _, actionId, _ -> if (actionId == EditorInfo.IME_ACTION_DONE) { pair(); true } else false }
        findViewById<Button>(R.id.setup_skip).setOnClickListener { skipSetup = true; shownStep = -1; refresh() }
        otherServer.setOnClickListener { customServer = true; refresh(); server.requestFocus() }
        openDev.setOnClickListener { openSettings(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS) }
        findViewById<Button>(R.id.unpair).setOnClickListener {
            AgentService.stop(this)
            prefs.clearPairing()
            refresh()
        }
    }

    override fun onResume() {
        super.onResume()
        shownStep = -1 // au retour des paramètres, on réévalue l'étape et on replace le focus
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

    private fun globalFlag(name: String) = try { Settings.Global.getInt(contentResolver, name, 0) == 1 } catch (_: Exception) { false }
    private fun developerEnabled() = globalFlag(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED)
    private fun adbEnabled() = globalFlag(Settings.Global.ADB_ENABLED)

    private fun openSettings(action: String) {
        val intents = listOf(Intent(action), Intent(Settings.ACTION_SETTINGS))
        for (i in intents) {
            try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return } catch (_: Exception) { }
        }
        showError("Impossible d'ouvrir les paramètres : ouvre-les avec la télécommande.")
    }

    private fun refresh() {
        val paired = prefs.paired
        // Étape à afficher : 1 = mode développeur, 2 = débogage, 3 = association
        val step = when {
            paired -> 0
            skipSetup -> 3
            !developerEnabled() -> 1
            !adbEnabled() -> 2
            else -> 3
        }
        setupGroup.visibility = if (step == 1 || step == 2) View.VISIBLE else View.GONE
        pairGroup.visibility = if (step == 3) View.VISIBLE else View.GONE
        statusGroup.visibility = if (paired) View.VISIBLE else View.GONE

        if (step != shownStep) {
            shownStep = step
            when (step) {
                1 -> showSetup(R.string.dev_step, R.string.dev_title, R.string.dev_text, R.string.dev_open, Settings.ACTION_DEVICE_INFO_SETTINGS)
                2 -> showSetup(R.string.adb_step, R.string.adb_title, R.string.adb_text, R.string.adb_open, Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
                3 -> showPair()
            }
        }
        if (step == 3) {
            val s = AgentService.status
            if (s.server == "revoked" && error.text.isEmpty()) showError(s.message)
        }
        if (paired) refreshStatus()
    }

    private fun showSetup(stepRes: Int, titleRes: Int, textRes: Int, buttonRes: Int, action: String) {
        setupStep.setText(stepRes)
        setupTitle.setText(titleRes)
        setupText.setText(textRes)
        setupOpen.setText(buttonRes)
        setupOpen.setOnClickListener { openSettings(action) }
        setupOpen.requestFocus()
    }

    private fun showPair() {
        val hasDefault = defaultServer.isNotEmpty() && !customServer && (prefs.server.isEmpty() || prefs.server == defaultServer)
        pairStep.visibility = if (skipSetup) View.GONE else View.VISIBLE
        intro.setText(if (hasDefault) R.string.intro_default else R.string.intro)
        serverLabel.visibility = if (hasDefault) View.GONE else View.VISIBLE
        server.visibility = if (hasDefault) View.GONE else View.VISIBLE
        otherServer.visibility = if (hasDefault) View.VISIBLE else View.GONE
        if (hasDefault) server.setText(defaultServer.removePrefix("https://"))
        code.requestFocus()
    }

    private fun refreshStatus() {
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
        openDev.visibility = if (s.adb == "unavailable") View.VISIBLE else View.GONE
        hint.text = when {
            s.adb != "ok" && s.adbMessage.isNotEmpty() -> s.adbMessage
            s.server == "ok" && s.adb == "ok" -> "Tout est prêt. Tu peux fermer cette appli : la TV reste reliée à ATV Manager, même après un redémarrage."
            else -> s.message
        }
    }

    private fun pair() {
        val url = Prefs.normalizeServer(server.text.toString())
        val c = code.text.toString().filter { it.isDigit() }
        if (url.isEmpty()) { showError("Entre l'adresse d'ATV Manager."); return }
        if (c.length != 6) { showError("Entre le code à 6 chiffres affiché dans ATV Manager."); return }
        pairButton.isEnabled = false
        pairButton.text = "Association…"
        error.visibility = View.GONE
        thread {
            val result = try {
                val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
                val body = JSONObject().put("code", c).put("name", "${Build.MANUFACTURER} ${Build.MODEL}").toString()
                    .toRequestBody("application/json".toMediaType())
                client.newCall(Request.Builder().url("$url/api/agent/pair").post(body).build()).execute().use { res ->
                    val json = try { JSONObject(res.body?.string() ?: "{}") } catch (_: Exception) { JSONObject() }
                    if (res.isSuccessful) {
                        prefs.server = url
                        prefs.agentId = json.getString("agentId")
                        prefs.token = json.getString("token")
                        null
                    } else json.optString("error", "Erreur ${res.code}")
                }
            } catch (e: Exception) {
                "Impossible de joindre $url. Vérifie la connexion internet de la TV."
            }
            main.post {
                pairButton.isEnabled = true
                pairButton.text = getString(R.string.pair)
                if (result == null) {
                    code.setText("")
                    AgentService.start(this)
                    shownStep = -1
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
