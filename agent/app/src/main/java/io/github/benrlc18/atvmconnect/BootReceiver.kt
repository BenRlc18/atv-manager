package io.github.benrlc18.atvmconnect

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Relance la connexion à ATV Manager au démarrage de la TV. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (Prefs(context).paired) AgentService.start(context)
    }
}
