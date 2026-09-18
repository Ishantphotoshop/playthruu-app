package com.playthruu.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.playthruu.android.data.Game
import com.playthruu.android.data.GameLog
import com.playthruu.android.data.LogDraft
import com.playthruu.android.data.Repository
import com.playthruu.android.ui.HairLine
import com.playthruu.android.ui.Loading
import com.playthruu.android.ui.Poster
import com.playthruu.android.ui.SectionHeading
import com.playthruu.android.ui.StarRow
import com.playthruu.android.ui.theme.Ink
import com.playthruu.android.ui.theme.Space
import com.playthruu.android.ui.theme.Unbounded
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * A game: the art, the numbers, the histogram, everyone's reviews, and
 * the way in to logging it yourself.
 */
@Composable
fun GameScreen(
    gameId: String,
    userId: String,
    repo: Repository,
    onBack: () -> Unit,
    onOpenProfile: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var game by remember { mutableStateOf<Game?>(null) }
    var logs by remember { mutableStateOf<List<GameLog>>(emptyList()) }
    var distribution by remember { mutableStateOf<List<Int>>(emptyList()) }
    var mine by remember { mutableStateOf<GameLog?>(null) }
    var loading by remember { mutableStateOf(true) }
    var showLogSheet by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun reload() {
        game = runCatching { repo.game(gameId) }.getOrNull()
        logs = runCatching { repo.logsForGame(gameId) }.getOrDefault(emptyList())
        distribution = runCatching { repo.ratingDistribution(gameId) }.getOrDefault(emptyList())
        mine = runCatching { repo.myLogForGame(userId, gameId) }.getOrNull()
        loading = false
    }

    LaunchedEffect(gameId) { reload() }

    if (loading) { Loading(modifier.fillMaxSize()); return }
    val g = game ?: run { com.playthruu.android.ui.EmptyState("That game isn't here.", modifier); return }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s2, vertical = Space.s2),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink.ink)
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s4),
            horizontalArrangement = Arrangement.spacedBy(Space.s3),
        ) {
            Poster(g.coverUrl, g.title, Modifier.width(118.dp), corner = 12.dp)
            Column(Modifier.weight(1f)) {
                Text(
                    g.title,
                    fontFamily = Unbounded,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 20.sp,
                    letterSpacing = (-0.3).sp,
                    color = Ink.ink,
                    lineHeight = 25.sp,
                )
                if (g.meta.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(g.meta, style = MaterialTheme.typography.bodySmall, color = Ink.inkDim)
                }
                g.studioName?.let {
                    Spacer(Modifier.height(2.dp))
                    Text(it, style = MaterialTheme.typography.bodySmall, color = Ink.inkFaint)
                }
                Spacer(Modifier.height(Space.s3))
                Button(
                    onClick = { showLogSheet = true },
                    shape = RoundedCornerShape(999.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (mine == null) Ink.accent else Ink.surfaceHigh,
                        contentColor = if (mine == null) Ink.bg else Ink.ink,
                    ),
                ) {
                    Text(
                        if (mine == null) "Log this" else "Edit your log",
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.5.sp,
                    )
                }
            }
        }

        Spacer(Modifier.height(Space.s4))
        RatingsPanel(distribution)

        if (!g.description.isNullOrBlank()) {
            SectionHeading("About")
            Text(
                g.description,
                style = MaterialTheme.typography.bodyMedium,
                color = Ink.inkDim,
                modifier = Modifier.padding(horizontal = Space.s4),
            )
            Spacer(Modifier.height(Space.s4))
        }

        SectionHeading("Reviews")
        if (logs.none { !it.review.isNullOrBlank() }) {
            com.playthruu.android.ui.EmptyState("No reviews yet — be the first.")
        } else {
            logs.filter { !it.review.isNullOrBlank() }.forEach { log ->
                ReviewRow(log, onOpenProfile)
                HairLine()
            }
        }
        Spacer(Modifier.height(96.dp))
    }

    if (showLogSheet) {
        LogSheet(
            game = g,
            existing = mine,
            onDismiss = { showLogSheet = false },
            onSave = { rating, review, status ->
                scope.launch {
                    runCatching {
                        repo.saveLog(
                            LogDraft(
                                userId = userId,
                                gameId = g.id,
                                rating = rating,
                                review = review.ifBlank { null },
                                status = status,
                            ),
                            existingId = mine?.id,
                        )
                    }
                    showLogSheet = false
                    reload()
                }
            },
        )
    }
}

/**
 * The ratings histogram, in the proportions the web app settled on after
 * measuring Letterboxd's: a 60px chart, sharp-cornered bars with a 1px
 * gap, and the average to the right at 20px semibold. Empty bars are
 * drawn even with no ratings at all — an empty chart still says "nobody
 * has rated this", where a missing one says nothing.
 */
@Composable
private fun RatingsPanel(distribution: List<Int>, modifier: Modifier = Modifier) {
    val buckets = if (distribution.size == 10) distribution else List(10) { 0 }
    val total = buckets.sum()
    val max = (buckets.maxOrNull() ?: 0).coerceAtLeast(1)
    val average = if (total == 0) null else
        buckets.mapIndexed { i, n -> (i + 1) * 0.5 * n }.sum() / total

    Column(modifier.fillMaxWidth().padding(horizontal = Space.s4)) {
        Text(
            "Ratings",
            style = MaterialTheme.typography.titleSmall,
            color = Ink.ink,
        )
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Text("★", color = Ink.accent, fontSize = 11.sp, modifier = Modifier.padding(end = 4.dp))
            Row(
                Modifier.weight(1f).height(60.dp),
                horizontalArrangement = Arrangement.spacedBy(1.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                buckets.forEach { n ->
                    // A floor of 4px so an empty bucket is still a visible
                    // baseline rather than nothing at all.
                    val fraction = if (total == 0) 0f else n.toFloat() / max
                    Box(
                        Modifier
                            .weight(1f)
                            .fillMaxHeight(fraction.coerceAtLeast(0.06f))
                            .background(if (n == 0) Ink.surfaceRaised else Ink.accent)
                    )
                }
            }
            Text("★★★★★", color = Ink.accent, fontSize = 11.sp, modifier = Modifier.padding(start = 4.dp))
            Column(
                Modifier.width(54.dp).padding(start = Space.s2),
                horizontalAlignment = Alignment.End,
            ) {
                Text(
                    average?.let { ((it * 10).roundToInt() / 10.0).toString() } ?: "–",
                    style = MaterialTheme.typography.titleLarge,
                    color = Ink.ink,
                )
                Text(
                    if (total == 1) "1 rating" else "$total ratings",
                    style = MaterialTheme.typography.bodySmall,
                    color = Ink.inkFaint,
                )
            }
        }
        Spacer(Modifier.height(Space.s4))
    }
}

@Composable
private fun ReviewRow(log: GameLog, onOpenProfile: (String) -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clickable { log.profiles?.username?.let(onOpenProfile) }
            .padding(horizontal = Space.s4, vertical = Space.s3)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
            com.playthruu.android.ui.Avatar(log.profiles, 26.dp)
            Text(
                log.profiles?.name ?: "Someone",
                style = MaterialTheme.typography.titleSmall,
                color = Ink.ink,
            )
            StarRow(log.rating, size = 12.sp, color = Ink.accentBright)
        }
        Spacer(Modifier.height(6.dp))
        Text(
            log.review.orEmpty(),
            style = MaterialTheme.typography.bodyMedium,
            color = Ink.inkDim,
        )
    }
}

/**
 * Rate, review, set a status. A half-star scale, because that is what
 * the database stores and what every rating in the app already is.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LogSheet(
    game: Game,
    existing: GameLog?,
    onDismiss: () -> Unit,
    onSave: (Double?, String, String) -> Unit,
) {
    var rating by remember { mutableStateOf(existing?.rating) }
    var review by remember { mutableStateOf(existing?.review.orEmpty()) }
    var status by remember { mutableStateOf(existing?.status ?: "played") }
    val sheetState = rememberModalBottomSheetState()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Ink.bgLift,
    ) {
        Column(Modifier.padding(horizontal = Space.s4).padding(bottom = Space.s5)) {
            Text(game.title, style = MaterialTheme.typography.titleMedium, color = Ink.ink)
            Spacer(Modifier.height(Space.s3))

            Text("Rating", style = MaterialTheme.typography.labelSmall, color = Ink.inkFaint)
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Ten taps, not five: a half-star is a real value here, so
                // each star is two targets rather than one.
                for (half in 1..10) {
                    val value = half * 0.5
                    val filled = (rating ?: 0.0) >= value
                    Box(
                        Modifier
                            .size(width = 17.dp, height = 34.dp)
                            .clickable {
                                rating = if (rating == value) null else value
                            },
                        contentAlignment = if (half % 2 == 1) Alignment.CenterStart else Alignment.CenterEnd,
                    ) {
                        Text(
                            if (half % 2 == 1) "★" else "★",
                            color = if (filled) Ink.accent else Ink.surfaceHigh,
                            fontSize = 28.sp,
                            modifier = Modifier.width(34.dp),
                        )
                    }
                }
                Spacer(Modifier.width(Space.s2))
                Text(
                    rating?.toString() ?: "–",
                    style = MaterialTheme.typography.titleSmall,
                    color = Ink.inkDim,
                )
            }

            Spacer(Modifier.height(Space.s3))
            Text("Status", style = MaterialTheme.typography.labelSmall, color = Ink.inkFaint)
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                listOf("played", "playing", "backlog", "dropped").forEach { option ->
                    val active = status == option
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(if (active) Ink.accentDim else Ink.surface)
                            .clickable { status = option }
                            .padding(horizontal = Space.s3, vertical = 7.dp)
                    ) {
                        Text(
                            option.replaceFirstChar { it.uppercase() },
                            style = MaterialTheme.typography.labelMedium,
                            color = if (active) Ink.accentBright else Ink.inkDim,
                        )
                    }
                }
            }

            Spacer(Modifier.height(Space.s3))
            OutlinedTextField(
                value = review,
                onValueChange = { review = it },
                label = { Text("Review") },
                minLines = 3,
                keyboardOptions = KeyboardOptions.Default,
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = Ink.surface,
                    unfocusedContainerColor = Ink.surface,
                    focusedBorderColor = Ink.accent,
                    unfocusedBorderColor = Ink.lineStrong,
                    focusedTextColor = Ink.ink,
                    unfocusedTextColor = Ink.ink,
                    cursorColor = Ink.accent,
                    focusedLabelColor = Ink.accent,
                    unfocusedLabelColor = Ink.inkDim,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(Space.s4))
            Button(
                onClick = { onSave(rating, review, status) },
                shape = RoundedCornerShape(999.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Ink.accent, contentColor = Ink.bg),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                Text(
                    if (existing == null) "Save to diary" else "Update",
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                )
            }
        }
    }
}
