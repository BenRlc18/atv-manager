package io.github.benrlc18.atvmconnect

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder

/**
 * Bandeau de dépannage pour une TV gérée en ADB direct (sans association) :
 * ATV Manager lance ce service par « am start-foreground-service ... --ez on true|false --el ttl <ms> ».
 * Réservé au shell ADB (permission DUMP dans le manifeste).
 */
class BannerService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Toujours passer au premier plan d'abord : Android l'exige pour un service lancé ainsi
        startForeground(NOTIF_ID, notification())
        if (intent?.getBooleanExtra("on", false) == true) {
            Banner.show(this, intent.getLongExtra("ttl", 90_000L)) { stopSelf() }
        } else {
            Banner.hide(this)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Dépannage à distance", NotificationManager.IMPORTANCE_LOW))
        }
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Accès à distance")
            .setContentText("Dépannage en cours depuis ATV Manager")
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL = "atvm-remote"
        private const val NOTIF_ID = 2
    }
}
