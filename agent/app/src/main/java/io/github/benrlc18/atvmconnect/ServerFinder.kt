package io.github.benrlc18.atvmconnect

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Trouve le serveur ATV Manager qui a généré le code, sans que l'utilisateur tape d'adresse :
 * 1. le serveur intégré à l'appli à la compilation (cas d'une TV chez un proche) ;
 * 2. sinon les instances ATV Manager du réseau local (port 8420).
 * Seul le serveur qui a généré le code l'accepte.
 */
object ServerFinder {
    data class Paired(val server: String, val agentId: String, val token: String)
    class PairError(message: String) : Exception(message)

    private const val LOCAL_PORT = 8420

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private sealed class Attempt {
        data class Ok(val paired: Paired) : Attempt()
        data class Refused(val message: String) : Attempt()
        object Unreachable : Attempt()
    }

    /** Lève PairError avec un message prêt à afficher si aucun serveur n'accepte le code. */
    fun pair(code: String, name: String, defaultServer: String): Paired {
        var refusal: String? = null

        if (defaultServer.isNotEmpty()) {
            when (val a = tryPair(defaultServer, code, name)) {
                is Attempt.Ok -> return a.paired
                is Attempt.Refused -> refusal = a.message
                Attempt.Unreachable -> Unit
            }
        }

        for (server in discoverLocal()) {
            when (val a = tryPair(server, code, name)) {
                is Attempt.Ok -> return a.paired
                is Attempt.Refused -> refusal = a.message
                Attempt.Unreachable -> Unit
            }
        }

        throw PairError(
            refusal ?: "ATV Manager est injoignable. Vérifie que la TV est connectée à internet, puis réessaie."
        )
    }

    private fun tryPair(server: String, code: String, name: String): Attempt {
        return try {
            val body = JSONObject().put("code", code).put("name", name).toString().toRequestBody("application/json".toMediaType())
            client.newCall(Request.Builder().url("$server/api/agent/pair").post(body).build()).execute().use { res ->
                val json = try { JSONObject(res.body?.string() ?: "{}") } catch (_: Exception) { JSONObject() }
                when {
                    res.isSuccessful && json.has("token") -> Attempt.Ok(Paired(server, json.getString("agentId"), json.getString("token")))
                    res.code == 403 || res.code == 429 -> Attempt.Refused(json.optString("error", "Code incorrect ou expiré."))
                    else -> Attempt.Unreachable
                }
            }
        } catch (_: Exception) {
            Attempt.Unreachable
        }
    }

    /** Cherche les ATV Manager du réseau local : port 8420 ouvert et API qui répond comme ATV Manager. */
    private fun discoverLocal(): List<String> {
        val prefixes = NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .filter { it.isSiteLocalAddress }
            .map { it.hostAddress!!.substringBeforeLast('.') }
            .distinct()
        if (prefixes.isEmpty()) return emptyList()

        val pool = Executors.newFixedThreadPool(48)
        try {
            val tasks = prefixes.flatMap { p -> (1..254).map { i -> "$p.$i" } }.map { host ->
                Callable { if (portOpen(host)) host else null }
            }
            val open = pool.invokeAll(tasks, 20, TimeUnit.SECONDS).mapNotNull { f -> try { f.get() } catch (_: Exception) { null } }
            return open.map { "http://$it:$LOCAL_PORT" }.filter { isAtvManager(it) }
        } finally {
            pool.shutdownNow()
        }
    }

    private fun portOpen(host: String): Boolean = try {
        Socket().use { it.connect(InetSocketAddress(host, LOCAL_PORT), 400); true }
    } catch (_: Exception) { false }

    private fun isAtvManager(server: String): Boolean = try {
        client.newCall(Request.Builder().url("$server/api/auth/status").build()).execute().use { res ->
            val json = JSONObject(res.body?.string() ?: "{}")
            res.isSuccessful && json.has("version") && json.has("setup")
        }
    } catch (_: Exception) { false }
}
