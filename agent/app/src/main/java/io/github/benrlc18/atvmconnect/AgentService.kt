package io.github.benrlc18.atvmconnect

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Service permanent : garde une connexion WebSocket sortante vers ATV Manager
 * et exécute les commandes reçues via l'ADB local de la TV.
 */
class AgentService : Service() {

    private lateinit var prefs: Prefs
    private lateinit var adb: LocalAdb
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .connectTimeout(15, TimeUnit.SECONDS)
        .build()
    private val main = Handler(Looper.getMainLooper())
    private val exec = Executors.newSingleThreadExecutor()
    private var socket: WebSocket? = null
    private var retryDelay = 5_000L
    private var stopped = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        adb = LocalAdb(this)
        startForeground(NOTIF_ID, notification("Connexion…"))
        exec.execute { adb.check(); sendStatus(); publish() }
        connect()
        main.postDelayed(adbWatch, 15_000)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!prefs.paired) { stopSelf(); return START_NOT_STICKY }
        return START_STICKY
    }

    override fun onDestroy() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        socket?.close(1000, "arrêt")
        exec.shutdownNow()
        adb.close()
        status = Status()
        super.onDestroy()
    }

    // Tant que l'ADB local n'est pas autorisé, on revérifie régulièrement
    private val adbWatch = object : Runnable {
        override fun run() {
            if (stopped) return
            if (adb.state != LocalAdb.State.OK) exec.execute {
                val before = adb.state
                adb.check()
                if (adb.state != before) sendStatus()
                publish()
            }
            main.postDelayed(this, 15_000)
        }
    }

    private fun connect() {
        if (stopped || !prefs.paired) return
        val url = prefs.server.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://") + "/api/agent/ws"
        status = status.copy(server = "connexion")
        publish()
        socket = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val hello = JSONObject()
                    .put("type", "hello")
                    .put("agentId", prefs.agentId)
                    .put("token", prefs.token)
                    .put("version", BuildConfigCompat.versionName(this@AgentService))
                    .put("adb", adbState())
                    .put("message", adb.message)
                webSocket.send(hello.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val m = try { JSONObject(text) } catch (_: Exception) { return }
                when (m.optString("type")) {
                    "welcome" -> {
                        retryDelay = 5_000L
                        status = status.copy(server = "ok")
                        publish()
                    }
                    "exec" -> {
                        val id = m.optInt("id")
                        val cmd = m.optString("cmd")
                        val timeout = m.optLong("timeout", 15_000L)
                        exec.execute {
                            val before = adb.state
                            val r = adb.shell(cmd, timeout)
                            if (adb.state != before) sendStatus()
                            val res = JSONObject().put("type", "result").put("id", id).put("ok", r.ok).put("out", r.out).put("err", r.err)
                            webSocket.send(res.toString())
                            publish()
                        }
                    }
                    "error" -> {
                        if (m.optString("code") == "revoked") {
                            prefs.clearPairing()
                            status = Status(server = "revoked", message = m.optString("message"))
                            publish()
                            main.post { stopSelf() }
                        }
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = retry("Serveur injoignable, nouvel essai bientôt.")

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = retry("Connexion fermée, nouvel essai bientôt.")
        })
    }

    private fun retry(msg: String) {
        if (stopped || !prefs.paired) return
        status = status.copy(server = "offline", message = msg)
        publish()
        main.postDelayed({ connect() }, retryDelay)
        retryDelay = (retryDelay * 2).coerceAtMost(60_000L)
    }

    private fun sendStatus() {
        socket?.send(JSONObject().put("type", "status").put("adb", adbState()).put("message", adb.message).toString())
    }

    private fun adbState() = when (adb.state) {
        LocalAdb.State.OK -> "ok"
        LocalAdb.State.UNAUTHORIZED -> "unauthorized"
        LocalAdb.State.UNAVAILABLE -> "unavailable"
        LocalAdb.State.UNKNOWN -> "unknown"
    }

    private fun publish() {
        status = status.copy(adb = adbState(), adbMessage = adb.message)
        val text = when {
            status.server == "ok" && status.adb == "ok" -> "Connectée à ATV Manager"
            status.server == "ok" -> "Connectée, débogage à autoriser"
            else -> "Hors ligne, nouvel essai en cours"
        }
        main.post { getSystemService(NotificationManager::class.java)?.notify(NOTIF_ID, notification(text)) }
    }

    private fun notification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "ATVM Connect", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("ATVM Connect")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    /** État affiché par l'écran principal. */
    data class Status(val server: String = "stopped", val adb: String = "unknown", val adbMessage: String = "", val message: String = "")

    companion object {
        private const val CHANNEL = "atvm"
        private const val NOTIF_ID = 1
        @Volatile var status = Status()

        fun start(context: Context) {
            val i = Intent(context, AgentService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i) else context.startService(i)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AgentService::class.java))
        }
    }
}

/** Lit la version de l'appli sans dépendre de BuildConfig. */
object BuildConfigCompat {
    fun versionName(context: Context): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""
    } catch (_: Exception) { "" }
}
