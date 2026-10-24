package io.github.benrlc18.atvmconnect

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.TextView

/**
 * Bandeau « Accès à distance : dépannage en cours », affiché par-dessus tout l'écran de la TV
 * pendant une session de dépannage. Il disparaît tout seul s'il n'est plus rafraîchi (session coupée).
 */
object Banner {
    private val main = Handler(Looper.getMainLooper())
    private var view: View? = null
    private var expires = 0L
    private var onHidden: (() -> Unit)? = null

    fun show(context: Context, ttlMs: Long, hidden: (() -> Unit)? = null) = main.post {
        expires = System.currentTimeMillis() + ttlMs
        if (hidden != null) onHidden = hidden
        if (view == null && Settings.canDrawOverlays(context)) {
            val app = context.applicationContext
            val v = build(app)
            val lp = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP or Gravity.END
                x = dp(app, 28)
                y = dp(app, 24)
            }
            try {
                app.getSystemService(WindowManager::class.java).addView(v, lp)
                view = v
            } catch (_: Exception) { }
        }
        main.removeCallbacks(watch)
        main.postDelayed(watch, 5_000)
    }

    fun hide(context: Context) = main.post { remove(context) }

    private val watch = object : Runnable {
        override fun run() {
            val v = view ?: return
            if (System.currentTimeMillis() > expires) remove(v.context) else main.postDelayed(this, 5_000)
        }
    }

    private fun remove(context: Context) {
        main.removeCallbacks(watch)
        view?.let { v ->
            try { context.applicationContext.getSystemService(WindowManager::class.java).removeView(v) } catch (_: Exception) { }
        }
        view = null
        onHidden?.invoke()
        onHidden = null
    }

    private fun build(context: Context): View {
        val label = "●  Accès à distance : dépannage en cours"
        val text = SpannableString(label).apply {
            setSpan(ForegroundColorSpan(Color.parseColor("#FF5A4F")), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        return TextView(context).apply {
            setText(text)
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setPadding(dp(context, 16), dp(context, 10), dp(context, 18), dp(context, 10))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#E61B1B19"))
                cornerRadius = dp(context, 10).toFloat()
            }
        }
    }

    private fun dp(context: Context, v: Int) = (v * context.resources.displayMetrics.density).toInt()
}
