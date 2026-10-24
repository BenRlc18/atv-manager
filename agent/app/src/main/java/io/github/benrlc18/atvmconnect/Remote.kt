package io.github.benrlc18.atvmconnect

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import dadb.AdbStream
import dadb.Dadb
import okhttp3.WebSocket
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * Dépannage à distance côté TV : captures d'écran réduites, et flux vidéo de scrcpy-server
 * relayé vers ATV Manager (trames binaires : 4 octets d'identifiant de session + données).
 */
class Remote(
    private val context: Context,
    private val adb: LocalAdb,
    private val prefs: Prefs,
    private val download: (String, File) -> Unit,
) {
    private val videos = ConcurrentHashMap<Int, Video>()

    /** Capture PNG de la TV, réduite et recompressée en JPEG (bien plus légère à envoyer), en base64. */
    fun screenshot(maxSize: Int, quality: Int): String {
        val png = adb.connect().use { d -> d.open("exec:screencap -p").use { it.source.readByteArray() } }
        val bmp = BitmapFactory.decodeByteArray(png, 0, png.size) ?: throw IOException("capture illisible")
        val scale = minOf(1f, maxSize.toFloat() / maxOf(bmp.width, bmp.height))
        val img = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true) else bmp
        val out = ByteArrayOutputStream()
        img.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(30, 90), out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    fun startVideo(ws: WebSocket, sid: Int, m: JSONObject) {
        val v = Video(sid)
        videos[sid] = v
        thread(name = "atvm-video-$sid") { v.run(ws, m) }
    }

    fun stopVideo(sid: Int) {
        videos.remove(sid)?.close()
    }

    fun stopAll() {
        videos.values.forEach { it.close() }
        videos.clear()
    }

    private inner class Video(val sid: Int) {
        @Volatile var closed = false
        private var dadb: Dadb? = null
        private var shell: AdbStream? = null
        private var stream: AdbStream? = null

        fun run(ws: WebSocket, m: JSONObject) {
            var reason = ""
            try {
                // Module vidéo téléchargé une fois depuis le serveur, puis envoyé sur la TV
                val path = m.optString("jar")
                val jar = File(context.filesDir, path.substringAfterLast('/'))
                if (!jar.exists() || jar.length() == 0L) download(prefs.server + path, jar)
                val d = adb.connect().also { dadb = it }
                d.push(jar, m.optString("path"))
                shell = d.open("shell:" + m.optString("cmd"))

                // Le serveur met un instant à écouter : on réessaie tant qu'aucune donnée n'arrive
                val head = ByteBuffer.allocate(4).putInt(sid).array()
                val buf = ByteArray(64 * 1024)
                var first = -1
                for (i in 0 until 40) {
                    if (closed) return
                    try {
                        val s = d.open("localabstract:scrcpy_" + m.optString("scid"))
                        first = s.source.read(buf)
                        if (first > 0) { stream = s; break }
                        s.close()
                    } catch (_: Exception) { }
                    Thread.sleep(250)
                }
                val s = stream ?: throw IOException("le module vidéo ne répond pas")
                var n = first
                while (!closed && n >= 0) {
                    if (n > 0) {
                        // Connexion trop lente pour suivre la vidéo : on arrête plutôt que d'accumuler du retard
                        if (ws.queueSize() > 8L * 1024 * 1024) { reason = "connexion trop lente pour la vidéo"; break }
                        ws.send((head + buf.copyOf(n)).toByteString())
                    }
                    n = s.source.read(buf)
                }
            } catch (e: Exception) {
                if (!closed) reason = e.message ?: e.javaClass.simpleName
            } finally {
                val stoppedByServer = closed
                close()
                videos.remove(sid)
                if (!stoppedByServer) ws.send(JSONObject().put("type", "video-end").put("sid", sid).put("message", reason).toString())
            }
        }

        fun close() {
            closed = true
            try { stream?.close() } catch (_: Exception) { }
            try { shell?.close() } catch (_: Exception) { }
            try { dadb?.close() } catch (_: Exception) { }
        }
    }
}
