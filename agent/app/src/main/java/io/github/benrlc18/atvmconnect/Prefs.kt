package io.github.benrlc18.atvmconnect

import android.content.Context

/** Réglages enregistrés sur la TV : adresse du serveur et identité de l'agent. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("atvm", Context.MODE_PRIVATE)

    var server: String
        get() = sp.getString("server", "") ?: ""
        set(v) = sp.edit().putString("server", v).apply()

    var agentId: String
        get() = sp.getString("agentId", "") ?: ""
        set(v) = sp.edit().putString("agentId", v).apply()

    var token: String
        get() = sp.getString("token", "") ?: ""
        set(v) = sp.edit().putString("token", v).apply()

    val paired: Boolean
        get() = server.isNotEmpty() && agentId.isNotEmpty() && token.isNotEmpty()

    /** La TV a accepté la fenêtre « Autoriser le débogage ? » pour cette appli (étape 3). */
    var adbAuthorized: Boolean
        get() = sp.getBoolean("adbAuthorized", false)
        set(v) = sp.edit().putBoolean("adbAuthorized", v).apply()

    fun clearPairing() {
        sp.edit().remove("agentId").remove("token").apply()
    }

    companion object {
        /** "atvm.exemple.fr" -> "https://atvm.exemple.fr" ; retire le "/" final. */
        fun normalizeServer(input: String): String {
            var s = input.trim().trimEnd('/')
            if (s.isEmpty()) return s
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
            return s
        }
    }
}
