package io.github.benrlc18.atvmconnect

import android.content.Context
import android.os.Build
import dadb.AdbKeyPair
import dadb.Dadb
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Client ADB vers la TV elle-même (127.0.0.1:5555).
 * La première connexion fait apparaître « Autoriser le débogage ? » sur la TV : on garde alors
 * la connexion ouverte (jusqu'à 2 minutes) le temps que la personne accepte. Couper plus tôt
 * ferme la fenêtre, en particulier sur les Fire TV qui l'affichent lentement.
 */
class LocalAdb(context: Context) {
    data class Result(val ok: Boolean, val out: String, val err: String)

    enum class State { OK, WAITING, UNAUTHORIZED, UNAVAILABLE, UNKNOWN }

    private val filesDir = context.filesDir
    private val worker = Executors.newSingleThreadExecutor()
    private val authorizing = AtomicBoolean(false)
    private var dadb: Dadb? = null

    private val keyPair: AdbKeyPair by lazy {
        val priv = File(filesDir, "adbkey")
        val pub = File(filesDir, "adbkey.pub")
        if (!priv.exists() || !pub.exists()) AdbKeyPair.generate(priv, pub)
        AdbKeyPair.read(priv, pub)
    }

    @Volatile var state: State = State.UNKNOWN
        private set
    @Volatile var message: String = ""
        private set

    /** Dernière erreur technique (affichée et envoyée au serveur pour le diagnostic). */
    @Volatile var lastError: String = ""
        private set

    // Certaines TV (Fire TV notamment) refusent le shell « v2 » : on bascule alors sur l'ancien mode « shell: »
    @Volatile private var legacyShell = false

    private fun describe(e: Throwable) = "${e.javaClass.simpleName}: ${e.message ?: "sans message"}".take(200)

    /** Exécute une commande shell ; les commandes passent une par une. */
    fun shell(cmd: String, timeoutMs: Long): Result {
        val future = worker.submit<Result> {
            val d = dadb ?: Dadb.create(HOST, PORT, keyPair).also { dadb = it }
            if (!legacyShell) {
                try {
                    val r = d.shell(cmd)
                    return@submit Result(r.exitCode == 0, r.output, r.errorOutput)
                } catch (e: Exception) {
                    lastError = "shell v2 : ${describe(e)}"
                }
            }
            // Ancien mode : pas de code de sortie, on lit la sortie jusqu'à la fin
            val out = d.open("shell:$cmd").use { it.source.readUtf8() }
            legacyShell = true
            Result(true, out, "")
        }
        return try {
            val r = future.get(timeoutMs, TimeUnit.MILLISECONDS)
            setState(State.OK, "")
            r
        } catch (e: TimeoutException) {
            future.cancel(true)
            reset()
            Result(false, "", "délai dépassé")
        } catch (e: Exception) {
            reset()
            lastError = describe(e.cause ?: e)
            if (!portOpen()) setState(State.UNAVAILABLE, portClosedMessage())
            Result(false, "", "ADB indisponible : $lastError")
        }
    }

    /**
     * Vérifie que l'ADB local répond et que la TV a autorisé cette appli.
     * Bloque jusqu'à 2 minutes si la fenêtre d'autorisation est affichée.
     */
    fun authorize(): State {
        if (!authorizing.compareAndSet(false, true)) return state
        try {
            if (!portOpen()) {
                setState(State.UNAVAILABLE, portClosedMessage())
                return state
            }
            if (state != State.OK) setState(State.WAITING, waitingMessage())
            val r = shell("echo atvm-ok", AUTH_WAIT_MS)
            if (r.ok && r.out.contains("atvm-ok")) setState(State.OK, "")
            else if (state != State.UNAVAILABLE) {
                // Échec rapide = erreur technique (pas un refus) : on la montre pour le diagnostic
                val detail = if (r.err == "délai dépassé") "" else " Détail technique : ${lastError.ifEmpty { r.err }}"
                setState(State.UNAUTHORIZED, noDialogMessage() + detail)
            }
            return state
        } finally {
            authorizing.set(false)
        }
    }

    private fun portOpen(): Boolean = isPortOpen()

    private val isFireTv = Build.MANUFACTURER.equals("Amazon", ignoreCase = true)

    private fun portClosedMessage() = if (isFireTv)
        "Le débogage n'est pas actif. Va dans Paramètres › Ma Fire TV › Options pour les développeurs et active « Débogage ADB »."
    else
        "Le débogage réseau n'est pas actif. Dans les options pour les développeurs, active « Débogage USB » et aussi « Débogage réseau » ou « Débogage ADB via le réseau » s'il existe."

    private fun waitingMessage() =
        "Une fenêtre « Autoriser le débogage ? » va s'afficher. Le bouton sélectionné au départ est souvent « Annuler » : avec les flèches, coche d'abord « Toujours autoriser depuis cet ordinateur », puis va sur « OK » (ou « Autoriser »)."

    private fun noDialogMessage() = if (isFireTv)
        "La fenêtre d'autorisation n'a pas été acceptée. Désactive puis réactive « Débogage ADB » (Paramètres › Ma Fire TV › Options pour les développeurs), puis rouvre ATVM Connect et attends la fenêtre."
    else
        "La fenêtre d'autorisation n'a pas été acceptée. Désactive puis réactive le débogage dans les options pour les développeurs, puis rouvre ATVM Connect et attends la fenêtre."

    private fun setState(s: State, msg: String) {
        state = s
        message = msg
    }

    private fun reset() {
        try { dadb?.close() } catch (_: Exception) { }
        dadb = null
    }

    /** Installe une APK (téléchargée par l'appli) via l'ADB local de la TV. */
    fun install(file: File, timeoutMs: Long): Result {
        val future = worker.submit<Result> {
            val d = dadb ?: Dadb.create(HOST, PORT, keyPair).also { dadb = it }
            d.install(file)
            Result(true, "Success", "")
        }
        return try {
            future.get(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            future.cancel(true)
            reset()
            Result(false, "", "délai dépassé")
        } catch (e: Exception) {
            reset()
            Result(false, "", "Installation impossible : ${describe(e.cause ?: e)}")
        }
    }

    /** Abandonne la tentative en cours (la fenêtre affichée se ferme) pour en relancer une neuve. */
    fun cancelAttempt() {
        reset()
    }

    val isAuthorizing: Boolean get() = authorizing.get()

    fun close() {
        reset()
        worker.shutdownNow()
    }

    companion object {
        const val HOST = "127.0.0.1"
        const val PORT = 5555
        const val AUTH_WAIT_MS = 120_000L

        /** Port ADB local ouvert = débogage actif, même si le réglage ne le dit pas (cas de certaines Fire TV). */
        fun isPortOpen(): Boolean = try {
            Socket().use { it.connect(InetSocketAddress(HOST, PORT), 1500); true }
        } catch (_: Exception) { false }
    }
}
