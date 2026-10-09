package com.playthruu.android.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * The web app's own icons, built from the SAME path strings as
 * components.js (so every shape is the one on the site, not a Material
 * stand-in). Colour comes from the Icon's tint, never from here.
 */
private class P(
    val d: String,
    val fill: Boolean = false,
    val stroke: Float = 0f,
    val round: Boolean = true,
)

private fun svg(name: String, vararg paths: P): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        for (p in paths) {
            addPath(
                pathData = addPathNodes(p.d),
                fill = if (p.fill) SolidColor(Color.Black) else null,
                stroke = if (p.stroke > 0f) SolidColor(Color.Black) else null,
                strokeLineWidth = p.stroke,
                strokeLineCap = if (p.round) StrokeCap.Round else StrokeCap.Butt,
                strokeLineJoin = if (p.round) StrokeJoin.Round else StrokeJoin.Miter,
            )
        }
    }.build()

object Icons {
    // ---- the tab bar -------------------------------------------------
    val HomeOff by lazy {
        svg("home_off",
            P("M3.5 11 12 3.5 20.5 11", stroke = 1.6f),
            P("M5.5 9.5V20a.5.5 0 0 0 .5.5h4v-6h4v6h4a.5.5 0 0 0 .5-.5V9.5", stroke = 1.6f))
    }
    val HomeOn by lazy { svg("home_on", P("M12 3.3 3 11h2v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9h2z", fill = true)) }
    val SearchOff by lazy {
        svg("search_off",
            P("M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z", stroke = 1.6f),
            P("m20.5 20.5-4.6-4.6", stroke = 1.6f))
    }
    val SearchOn by lazy {
        svg("search_on",
            P("M18.6 11a7.6 7.6 0 1 1-15.2 0 7.6 7.6 0 0 1 15.2 0z", fill = true),
            P("m20.4 20.4-4.5-4.5", stroke = 2.8f))
    }
    val BellOff by lazy {
        svg("bell_off",
            P("M18 9a6 6 0 1 0-12 0c0 5.2-1.6 6.6-2 7 .6.4 1.4.5 2 .5h12c.6 0 1.4-.1 2-.5-.4-.4-2-1.8-2-7z", stroke = 1.8f),
            P("M10.3 20a2 2 0 0 0 3.4 0", stroke = 1.8f))
    }
    val BellOn by lazy {
        svg("bell_on",
            P("M18 9a6 6 0 1 0-12 0c0 5.2-1.6 6.6-2 7 .6.4 1.4.5 2 .5h12c.6 0 1.4-.1 2-.5-.4-.4-2-1.8-2-7z", fill = true, stroke = 1.8f),
            P("M10.3 20a2 2 0 0 0 3.4 0", stroke = 1.8f))
    }
    val Plus by lazy { svg("plus", P("M12 5v14M5 12h14", stroke = 2.4f)) }

    // ---- general ------------------------------------------------------
    val Back by lazy { svg("back", P("M15 5l-7 7 7 7", stroke = 2.2f)) }
    val Close by lazy { svg("close", P("M6 6l12 12M18 6 6 18", stroke = 2.2f)) }
    val Check by lazy { svg("check", P("M5 12.5l4.5 4.5L19 7.5", stroke = 2.4f)) }
    val ChevronRight by lazy { svg("chev_r", P("M9 5l7 7-7 7", stroke = 2.2f)) }
    val ChevronDown by lazy { svg("chev_d", P("M6 9l6 6 6-6", stroke = 2.4f)) }
    val Filter by lazy { svg("filter", P("M4 4h16l-6 8v6l-4 2v-8z", fill = true)) }
    val SearchLine by lazy {
        svg("search_line",
            P("M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z", stroke = 2.2f),
            P("M16 16l4.5 4.5", stroke = 2.2f))
    }
    val Replay by lazy {
        svg("replay",
            P("M20 12a8 8 0 1 1-2.6-5.9", stroke = 2f),
            P("M20 4v5h-5", stroke = 2f))
    }
    val ReviewLines by lazy { svg("review_lines", P("M4 7h16M4 12h16M4 17h10", stroke = 2f)) }
    val Heart by lazy { svg("heart", P("M12 20.3 4.3 12.6A4.7 4.7 0 0 1 11 6l1 1 1-1a4.7 4.7 0 0 1 6.7 6.6z", stroke = 1.9f)) }
    val HeartSolid by lazy { svg("heart_solid", P("M12 20.3 4.3 12.6A4.7 4.7 0 0 1 11 6l1 1 1-1a4.7 4.7 0 0 1 6.7 6.6z", fill = true)) }
    val Dice by lazy {
        svg("dice",
            P("M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z", stroke = 1.8f),
            P("M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01", stroke = 2.6f))
    }
    val Settings by lazy {
        svg("settings",
            P("M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z", stroke = 1.8f),
            P("M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6", stroke = 1.8f))
    }
}
