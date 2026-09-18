package com.playthruu.android.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The bottom nav's real icons, traced from the exact <path> data in
 * components.js (iconHomeFilled / iconSearchFilled / iconMessageFilled /
 * iconUserFilled / iconBrandMark). Not Material's stand-ins — those are
 * a different shape and reads as a different app the moment you look at
 * the tab bar, which is on screen constantly.
 */
object NavIcons {
    val Home: ImageVector by lazy {
        ImageVector.Builder("nav_home", 24.dp, 24.dp, 24f, 24f).apply {
            path(fill = androidx.compose.ui.graphics.SolidColor(Color.Black)) {
                moveTo(12f, 3.3f); lineTo(3f, 11f); horizontalLineTo(5f); verticalLineTo(20f)
                arcToRelative(1f, 1f, 0f, false, false, 1f, 1f); horizontalLineTo(10f)
                verticalLineTo(15f); horizontalLineTo(14f); verticalLineTo(21f); horizontalLineTo(18f)
                arcToRelative(1f, 1f, 0f, false, false, 1f, -1f); verticalLineTo(11f); horizontalLineTo(21f); close()
            }
        }.build()
    }

    val Search: ImageVector by lazy {
        ImageVector.Builder("nav_search", 24.dp, 24.dp, 24f, 24f).apply {
            path(fill = androidx.compose.ui.graphics.SolidColor(Color.Black)) {
                moveTo(11f, 3f)
                arcToRelative(8f, 8f, 0f, true, false, 4.9f, 14.3f)
                lineToRelative(4.4f, 4.4f); lineToRelative(1.4f, -1.4f); lineToRelative(-4.4f, -4.4f)
                arcTo(8f, 8f, 0f, false, false, 11f, 3f); close()
                moveTo(11f, 5f)
                arcToRelative(6f, 6f, 0f, true, true, 0f, 12f)
                arcToRelative(6f, 6f, 0f, true, true, 0f, -12f); close()
            }
        }.build()
    }

    val Message: ImageVector by lazy {
        ImageVector.Builder("nav_message", 24.dp, 24.dp, 24f, 24f).apply {
            path(fill = androidx.compose.ui.graphics.SolidColor(Color.Black)) {
                moveTo(6.5f, 4f); horizontalLineTo(17.5f)
                arcToRelative(2.5f, 2.5f, 0f, false, true, 2.5f, 2.5f); verticalLineTo(13.5f)
                arcToRelative(2.5f, 2.5f, 0f, false, true, -2.5f, 2.5f); horizontalLineTo(10f)
                lineToRelative(-4.5f, 4f); verticalLineTo(16f); horizontalLineTo(6.5f)
                arcToRelative(2.5f, 2.5f, 0f, false, true, -2.5f, -2.5f); verticalLineTo(6.5f)
                arcTo(2.5f, 2.5f, 0f, false, true, 6.5f, 4f); close()
            }
        }.build()
    }

    val Person: ImageVector by lazy {
        ImageVector.Builder("nav_person", 24.dp, 24.dp, 24f, 24f).apply {
            path(fill = androidx.compose.ui.graphics.SolidColor(Color.Black)) {
                moveTo(12f, 8f)
                moveToRelative(-3.5f, 0f)
                arcToRelative(3.5f, 3.5f, 0f, true, true, 7f, 0f)
                arcToRelative(3.5f, 3.5f, 0f, true, true, -7f, 0f); close()
            }
            path(fill = androidx.compose.ui.graphics.SolidColor(Color.Black)) {
                moveTo(12f, 13f)
                curveTo(8f, 13f, 4.5f, 15.4f, 3.4f, 19.4f)
                arcToRelative(1f, 1f, 0f, false, false, 1f, 1.3f); horizontalLineTo(19.6f)
                arcToRelative(1f, 1f, 0f, false, false, 1f, -1.3f)
                curveTo(19.5f, 15.4f, 16f, 13f, 12f, 13f); close()
            }
        }.build()
    }

    /** The wordmark's own "PT" glyph — a torus with a bite, from the SVG
     *  everything else in the app (favicon, mark-blue.svg) uses too. */
    val Brand: ImageVector by lazy {
        ImageVector.Builder("nav_brand", 24.dp, 24.dp, 120f, 120f).apply {
            path(fill = androidx.compose.ui.graphics.SolidColor(Color.Black), pathFillType = PathFillType.NonZero) {
                moveTo(113.4045f, 52f)
                arcTo(54f, 54f, 0f, true, true, 113.4045f, 68f)
                lineTo(64f, 68f)
                arcToRelative(8f, 8f, 0f, false, true, 0f, -16f)
                close()
            }
        }.build()
    }
}
