package com.playthruu.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.playthruu.android.R

/**
 * The web app's palette, lifted value-for-value out of css/styles.css
 * rather than approximated. Keeping the two in step matters more than it
 * sounds: the same person uses both, and a slightly different orange or
 * a slightly lighter card reads as a different, worse app rather than as
 * the same one built twice.
 *
 * Deliberately one fixed dark palette, no light variant and no dynamic
 * colour. The web app commits to a single dark look; letting Android's
 * Material You repaint this one in the phone's wallpaper colours would
 * throw away the identity the whole thing is built on.
 */
object Ink {
    // Coffee brown, lifted from the web app's :root (css/styles.css).
    val bg = Color(0xFF1C1009)
    val bgDeep = Color(0xFF120A05)
    val bgLift = Color(0xFF26160D)
    val surface = Color(0xFF2E1B10)
    val surfaceRaised = Color(0xFF3B2416)
    val surfaceHigh = Color(0xFF4F3220)

    val ink = Color(0xFFFBEFE2)
    val inkDim = Color(0xFFD9BB9C)
    val inkFaint = Color(0xFFB99872)
    val inkGhost = Color(0xFF8D6A48)

    // The accent is green now.
    val accent = Color(0xFF00E054)
    val accentBright = Color(0xFF00FF62)
    val accentDeep = Color(0xFF00C030)
    val accentDim = Color(0x2600E054)

    val gold = Color(0xFF00E054)      // stars are the accent green
    val starEmpty = Color(0xFF4F3220)
    val orange = Color(0xFFFF9933)
    val coral = Color(0xFFFF9933)
    val teal = Color(0xFF40BCF4)
    val violet = Color(0xFF40BCF4)

    // rgba(230,170,110,0.18) / 0.30 over the ground: Compose borders do
    // not composite the way CSS ones do, so they are kept as alpha colours.
    val line = Color(0x2EE6AA6E)
    val lineStrong = Color(0x4DE6AA6E)

    val danger = Color(0xFFFF5A5F)
    val success = Color(0xFF00E054)
}

/** Spacing, straight from the --space-* scale. */
object Space {
    val s1 = 4.dp
    val s2 = 8.dp
    val s3 = 14.dp
    val s4 = 20.dp
    val s5 = 28.dp
    val s6 = 40.dp
    val gutter = 16.dp
}

/**
 * Manrope for everything, Unbounded for the wordmark and the segmented
 * tabs — exactly the split the web app uses, and the one place where
 * getting it wrong would be most obvious. Bundled as assets rather than
 * fetched, so the app has no network dependency for its own type.
 */
// Google publishes both of these as VARIABLE fonts only — one file with
// a continuous weight axis rather than a file per weight. So each weight
// below is the same file asked for a different point on that axis, which
// is also why the two together cost under a megabyte instead of the ten
// or so a dozen static cuts would.
@OptIn(ExperimentalTextApi::class)
private fun weightAxis(weight: Int) = FontVariation.Settings(FontVariation.weight(weight))

@OptIn(ExperimentalTextApi::class)
val Manrope = FontFamily(
    Font(R.font.manrope_variable, FontWeight.Light, variationSettings = weightAxis(300)),
    Font(R.font.manrope_variable, FontWeight.Normal, variationSettings = weightAxis(400)),
    Font(R.font.manrope_variable, FontWeight.Medium, variationSettings = weightAxis(500)),
    Font(R.font.manrope_variable, FontWeight.SemiBold, variationSettings = weightAxis(600)),
    Font(R.font.manrope_variable, FontWeight.Bold, variationSettings = weightAxis(700)),
    Font(R.font.manrope_variable, FontWeight.ExtraBold, variationSettings = weightAxis(800)),
)

// Only 700/800/900 are ever used, matching the three weights index.html
// loads for the wordmark — anything lighter loses the chunky geometry
// that is the whole reason this face is here.
@OptIn(ExperimentalTextApi::class)
val Unbounded = FontFamily(
    Font(R.font.unbounded_variable, FontWeight.Bold, variationSettings = weightAxis(700)),
    Font(R.font.unbounded_variable, FontWeight.ExtraBold, variationSettings = weightAxis(800)),
    Font(R.font.unbounded_variable, FontWeight.Black, variationSettings = weightAxis(900)),
)

private val PlaythruuTypography = Typography(
    displayLarge = TextStyle(fontFamily = Unbounded, fontWeight = FontWeight.Bold, fontSize = 28.sp, letterSpacing = (-0.3).sp),
    headlineMedium = TextStyle(fontFamily = Unbounded, fontWeight = FontWeight.Bold, fontSize = 22.sp, letterSpacing = (-0.2).sp),
    titleLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp),
    titleMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 16.sp),
    titleSmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 14.sp),
    bodyLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 21.sp),
    bodyMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Normal, fontSize = 12.5.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 14.sp),
    labelMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 12.sp),
    // Uppercase group headings — the letter-spacing is what makes them
    // read as labels rather than as small headings.
    labelSmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.9.sp),
)

private val PlaythruuColors = darkColorScheme(
    primary = Ink.accent,
    onPrimary = Ink.bg,
    primaryContainer = Ink.accentDim,
    onPrimaryContainer = Ink.accentBright,
    secondary = Ink.teal,
    background = Ink.bg,
    onBackground = Ink.ink,
    surface = Ink.surface,
    onSurface = Ink.ink,
    surfaceVariant = Ink.surfaceRaised,
    onSurfaceVariant = Ink.inkDim,
    surfaceContainer = Ink.surfaceRaised,
    surfaceContainerHigh = Ink.surfaceHigh,
    outline = Ink.lineStrong,
    outlineVariant = Ink.line,
    error = Ink.danger,
)

@Composable
fun PlaythruuTheme(content: @Composable () -> Unit) {
    // isSystemInDarkTheme is read and ignored on purpose: this app is
    // dark either way, and touching it here documents that as a decision
    // rather than an oversight.
    @Suppress("UNUSED_EXPRESSION") isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = PlaythruuColors,
        typography = PlaythruuTypography,
        content = content,
    )
}
