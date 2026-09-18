package com.playthruu.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.playthruu.android.data.Profile
import com.playthruu.android.ui.theme.Ink
import com.playthruu.android.ui.theme.Space
import com.playthruu.android.ui.theme.Unbounded
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException

/**
 * The shared pieces, matching what components.js draws on the web. Same
 * proportions, same radii, same weights — the point of a second client
 * is that it is recognisably the same product.
 */

/** "4h", "2d" — the same scale timeAgo() uses in utils.js. */
fun timeAgo(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    val then = try {
        Instant.parse(if (iso.endsWith("Z")) iso else iso.replace(" ", "T").let {
            if (it.contains("+") || it.endsWith("Z")) it else it + "Z"
        })
    } catch (e: DateTimeParseException) {
        return ""
    }
    val seconds = Duration.between(then, Instant.now()).seconds
    return when {
        seconds < 60 -> "just now"
        seconds < 3600 -> "${seconds / 60}m"
        seconds < 86_400 -> "${seconds / 3600}h"
        seconds < 2_592_000 -> "${seconds / 86_400}d"
        else -> "${seconds / 2_592_000}mo"
    }
}

/**
 * A game cover. Portrait 3:4, and a generated placeholder rather than a
 * grey box when there is no art — the web app does the same thing, and a
 * wall of identical grey rectangles is the fastest way to make a catalogue
 * look broken.
 */
@Composable
fun Poster(
    url: String?,
    title: String,
    modifier: Modifier = Modifier,
    corner: Dp = 10.dp,
) {
    Box(
        modifier
            .aspectRatio(3f / 4f)
            .clip(RoundedCornerShape(corner))
            .background(placeholderBrush(title)),
    ) {
        if (!url.isNullOrBlank()) {
            AsyncImage(
                model = url,
                contentDescription = title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text(
                title,
                color = Color.White.copy(alpha = 0.72f),
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.Center).padding(8.dp),
            )
        }
    }
}

/** A stable per-title gradient, so the same game always looks the same. */
private fun placeholderBrush(seed: String): Brush {
    val h = seed.fold(0) { acc, c -> (acc * 31 + c.code) and 0xFFFFFF }
    val hue = (h % 360).toFloat()
    return Brush.linearGradient(
        listOf(
            Color.hsl(hue, 0.28f, 0.22f),
            Color.hsl((hue + 40f) % 360f, 0.30f, 0.13f),
        )
    )
}

/** A round avatar, falling back to initials on the app's surface colour. */
@Composable
fun Avatar(profile: Profile?, size: Dp, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(Ink.surfaceHigh),
        contentAlignment = Alignment.Center,
    ) {
        val url = profile?.avatarUrl
        if (!url.isNullOrBlank()) {
            AsyncImage(
                model = url,
                contentDescription = profile.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text(
                profile?.initials ?: "?",
                color = Ink.inkDim,
                fontWeight = FontWeight.Bold,
                fontSize = (size.value * 0.34f).sp,
            )
        }
    }
}

/**
 * The star row. Drawn as glyphs rather than vector icons for the same
 * reason the web app uses a font star: half-stars stay exactly half at
 * every size, and the row's baseline matches the text beside it.
 */
@Composable
fun StarRow(
    rating: Double?,
    size: androidx.compose.ui.unit.TextUnit = 13.sp,
    color: Color = Ink.ink,
    showEmpty: Boolean = false,
) {
    if (rating == null && !showEmpty) return
    val value = rating ?: 0.0
    Row(verticalAlignment = Alignment.CenterVertically) {
        for (i in 1..5) {
            val glyph = when {
                value >= i -> "★"
                value >= i - 0.5 -> "⯨"
                showEmpty -> "☆"
                else -> null
            } ?: break
            Text(glyph, color = color, fontSize = size, fontWeight = FontWeight.Normal)
        }
    }
}

/** A section heading — the same 13px uppercase label the web app uses. */
@Composable
fun SectionHeading(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = Ink.inkFaint,
        modifier = modifier.padding(horizontal = Space.s4, vertical = Space.s2),
    )
}

/** The app's title bar: the wordmark face, left-aligned, with an optional
 *  action on the right. */
@Composable
fun TopBar(
    title: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Space.s4, vertical = Space.s3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            fontFamily = Unbounded,
            fontWeight = FontWeight.Bold,
            fontSize = 21.sp,
            letterSpacing = (-0.2).sp,
            color = Ink.ink,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        action?.invoke()
    }
}

/**
 * The segmented control. Unbounded at 700, because those are the weights
 * loaded for it and the web app's own tabs use exactly this treatment.
 */
@Composable
fun Segmented(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(999.dp))
            .background(Ink.surface)
            .border(BorderStroke(1.dp, Ink.line), RoundedCornerShape(999.dp))
            .padding(Space.s1),
        horizontalArrangement = Arrangement.spacedBy(Space.s1),
    ) {
        options.forEachIndexed { index, label ->
            val active = index == selectedIndex
            Box(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(999.dp))
                    .background(if (active) Ink.surfaceHigh else Color.Transparent)
                    .clickable { onSelect(index) }
                    .padding(vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    fontFamily = Unbounded,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.5.sp,
                    letterSpacing = (-0.1).sp,
                    color = if (active) Ink.ink else Ink.inkDim,
                    maxLines = 1,
                )
            }
        }
    }
}

/** A quiet empty state — a sentence, not an illustration. */
@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Box(
        modifier.fillMaxWidth().padding(Space.s5),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            color = Ink.inkDim,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
fun Loading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(Space.s5), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Ink.accent, strokeWidth = 2.5.dp, modifier = Modifier.size(26.dp))
    }
}

/** The status stamp on a diary row — PLAYED / PLAYING / BACKLOG. */
@Composable
fun StatusStamp(status: String, modifier: Modifier = Modifier) {
    val color = when (status) {
        "playing" -> Ink.teal
        "backlog" -> Ink.violet
        "dropped" -> Ink.coral
        else -> Ink.success
    }
    Text(
        status.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = color,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** A hairline divider that matches --line rather than Material's. */
@Composable
fun HairLine(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(Ink.line))
}
