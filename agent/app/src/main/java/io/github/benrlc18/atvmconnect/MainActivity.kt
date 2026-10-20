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
    private lateinit var pairStep: TextView
    private lateinit var intro: TextView
    private lateinit var code: EditText
    private lateinit var pairButton: Button
    private lateinit var error: TextView
    private lateinit var connLine: TextView
    private lateinit var adbLine: TextView
    private lateinit var hint: TextView
    private lateinit var openDev: Button
    private lateinit var recheckButton: Button
    private lateinit var lastCheck: TextView
    private var checkingUntil = 0L
    private lateinit var askAuthButton: Button
    private var askedAt = 0L
    private lateinit var remoteToggle: Button
    private lateinit var remoteServer: EditText

    private var skipSetup = false
    private var shownStep = -1

    private val defaultServer: String get() = Prefs.normalizeServer(BuildConfig.DEFAULT_SERVER)
    private val isFireTv = Build.MANUFACTURER.equals("Amazon", ignoreCase = true)

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
        pairStep = findViewById(R.id.pair_step)
        intro = findViewById(R.id.intro)
        code = findViewById(R.id.code)
        pairButton = findViewById(R.id.pair)
        error = findViewById(R.id.error)
        connLine = findViewById(R.id.conn_line)
        adbLine = findViewById(R.id.adb_line)
        hint = findViewById(R.id.hint)
        openDev = findViewById(R.id.open_dev)
        recheckButton = findViewById(R.id.recheck)
        askAuthButton = findViewById(R.id.ask_auth)
        // « Afficher la fenêtre d'autorisation » : relance la demande, la fenêtre apparaît sur la TV
        askAuthButton.setOnClickListener {
            askedAt = System.currentTimeMillis()
            AgentService.askAuth(this)
            refresh()
        }
        lastCheck = findViewById(R.id.last_check)
        // « Vérifier la connexion » : reconnexion + nouveau test du débogage, bilan affiché quelques secondes après
        recheckButton.setOnClickListener {
            checkingUntil = System.currentTimeMillis() + 6_000
            AgentService.recheck(this)
            refresh()
        }
        remoteToggle = findViewById(R.id.remote_toggle)
        remoteServer = findViewById(R.id.remote_server)
        // Version générique (sans serveur intégré) : adresse saisissable seulement sur demande
        remoteToggle.setOnClickListener {
            remoteToggle.visibility = View.GONE
            remoteServer.visibility = View.VISIBLE
            remoteServer.requestFocus()
        }

        pairButton.setOnClickListener { pair() }
        code.setOnEditorActionListener { _, actionId, _ -> if (actionId == EditorInfo.IME_ACTION_DONE) { pair(); true } else false }
        findViewById<Button>(R.id.setup_skip).setOnClickListener { skipSetup = true; shownStep = -1; refresh() }
        openDev.setOnClickListener { openSettings(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS) }
        findViewById<Button>(R.id.unpair).setOnClickListener {
            AgentService.stop(this)
            prefs.clearPairing()
            prefs.server = ""
            shownStep = -1
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
                1 -> showSetup(R.string.dev_step, R.string.dev_title, if (isFireTv) R.string.dev_text_fire else R.string.dev_text, R.string.dev_open, Settings.ACTION_DEVICE_INFO_SETTINGS)
                2 -> showSetup(R.string.adb_step, R.string.adb_title, if (isFireTv) R.string.adb_text_fire else R.string.adb_text, R.string.adb_open, Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
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
        pairStep.visibility = if (skipSetup) View.GONE else View.VISIBLE
        if (defaultServer.isEmpty() && remoteServer.visibility != View.VISIBLE) remoteToggle.visibility = View.VISIBLE
        code.requestFocus()
    }

    private fun refreshStatus() {
        val s = AgentService.status
        connLine.text = when (s.server) {
            "ok" -> "● Connectée à ATV Manager"
            "connexion" -> "○ Connexion en cours…"
            else -> "○ Hors ligne : nouvel essai automatique"
        }
        adbLine.text = when (s.adb) {
            "ok" -> "● Débogage autorisé"
            "waiting" -> "○ En attente de ton accord : regarde la fenêtre à l'écran"
            "unauthorized" -> "○ Débogage à autoriser"
            "unavailable" -> "○ Débogage réseau désactivé"
            else -> "○ Vérification du débogage…"
        }
        openDev.visibility = if (s.adb == "unavailable") View.VISIBLE else View.GONE

        // Bouton d'autorisation : seulement tant que le débogage n'est pas autorisé (et que le port est ouvert)
        askAuthButton.visibility = if (s.adb != "ok" && s.adb != "unavailable") View.VISIBLE else View.GONE

        val checking = System.currentTimeMillis() < checkingUntil
        recheckButton.isEnabled = !checking
        recheckButton.setText(if (checking) R.string.rechecking else R.string.recheck)
        if (s.lastCheck > 0 && !checking) {
            val time = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.FRANCE).format(java.util.Date(s.lastCheck))
            lastCheck.text = when {
                s.server == "ok" && s.adb == "ok" -> "Vérifié à $time : tout fonctionne, la TV est prête à être optimisée."
                s.server != "ok" -> "Vérifié à $time : ATV Manager est injoignable. Vérifie la connexion internet de la TV ; un nouvel essai est fait automatiquement."
                else -> "Vérifié à $time : la connexion au serveur est bonne, mais le débogage n'est pas encore autorisé (voir le message ci-dessus)."
            }
            lastCheck.visibility = View.VISIBLE
        } else if (checking) {
            lastCheck.text = getString(R.string.rechecking)
            lastCheck.visibility = View.VISIBLE
        }
        hint.text = when {
            s.adb != "ok" && System.currentTimeMillis() - askedAt < 120_000 -> getString(R.string.asking_auth)
            s.adb != "ok" && s.adbMessage.isNotEmpty() -> s.adbMessage
            s.server == "ok" && s.adb == "ok" -> "Tout est prêt. Tu peux fermer cette appli : la TV reste reliée à ATV Manager, même après un redémarrage."
            else -> s.message
        }
    }

    // Le serveur est trouvé automatiquement : celui qui a généré le code (voir ServerFinder)
    private fun pair() {
        val c = code.text.toString().filter { it.isDigit() }
        if (c.length != 6) { showError("Entre le code à 6 chiffres affiché dans ATV Manager."); return }
        pairButton.isEnabled = false
        pairButton.setText(R.string.pairing)
        error.visibility = View.GONE
        thread {
            val result = try {
                val typed = Prefs.normalizeServer(remoteServer.text.toString())
                val p = ServerFinder.pair(c, "${Build.MANUFACTURER} ${Build.MODEL}", typed.ifEmpty { defaultServer })
                prefs.server = p.server
                prefs.agentId = p.agentId
                prefs.token = p.token
                null
            } catch (e: ServerFinder.PairError) {
                e.message
            } catch (e: Exception) {
                "ATV Manager est injoignable. Vérifie la connexion internet de la TV, puis réessaie."
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
