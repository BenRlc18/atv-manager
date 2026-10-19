package io.github.benrlc18.atvmconnect

import android.content.Context
import dadb.AdbKeyPair
import dadb.Dadb
import java.io.File
import java.net.ConnectException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Client ADB vers la TV elle-même (127.0.0.1:5555).
 * La première connexion fait apparaître « Autoriser le débogage ? » sur la TV.
 */
class LocalAdb(context: Context) {
    data class Result(val ok: Boolean, val out: String, val err: String)

    enum class State { OK, UNAUTHORIZED, UNAVAILABLE, UNKNOWN }

    private val filesDir = context.filesDir
    private val worker = Executors.newSingleThreadExecutor()
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

    /** Exécute une commande shell ; les commandes passent une par une. */
    fun shell(cmd: String, timeoutMs: Long): Result {
        val future = worker.submit<Result> {
            val d = dadb ?: Dadb.create(HOST, PORT, keyPair).also { dadb = it }
            val r = d.shell(cmd)
            Result(r.exitCode == 0, r.output, r.errorOutput)
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
            classify(e.cause ?: e)
            Result(false, "", message)
        }
    }

    /** Vérifie que l'ADB local répond et que la TV a autorisé cette appli. */
    fun check(): State {
        val r = shell("echo atvm-ok", 8000)
        if (r.ok && r.out.contains("atvm-ok")) setState(State.OK, "")
        else if (r.err == "délai dépassé") setState(State.UNAUTHORIZED, "Accepte la fenêtre « Autoriser le débogage ? » sur la TV (coche « Toujours autoriser »).")
        return state
    }

    private fun classify(e: Throwable) {
        if (e is ConnectException || e.message?.contains("ECONNREFUSED") == true || e.message?.contains("Connection refused") == true) {
            setState(State.UNAVAILABLE, "Le débogage réseau de la TV est désactivé. Active « Débogage USB » et « Débogage réseau » dans les options pour les développeurs.")
        } else {
            setState(State.UNAUTHORIZED, "Accepte la fenêtre « Autoriser le débogage ? » sur la TV (coche « Toujours autoriser »).")
        }
    }

    private fun setState(s: State, msg: String) {
        state = s
        message = msg
    }

    private fun reset() {
        try { dadb?.close() } catch (_: Exception) { }
        dadb = null
    }

    fun close() {
        reset()
        worker.shutdownNow()
    }

    companion object {
        const val HOST = "127.0.0.1"
        const val PORT = 5555
    }
}
