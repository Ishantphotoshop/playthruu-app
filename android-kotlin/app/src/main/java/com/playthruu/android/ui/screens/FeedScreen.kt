package com.playthruu.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.playthruu.android.data.GameLog
import com.playthruu.android.data.Repository
import com.playthruu.android.ui.Avatar
import com.playthruu.android.ui.EmptyState
import com.playthruu.android.ui.HairLine
import com.playthruu.android.ui.Loading
import com.playthruu.android.ui.Poster
import com.playthruu.android.ui.StarRow
import com.playthruu.android.ui.StatusStamp
import com.playthruu.android.ui.timeAgo
import com.playthruu.android.ui.theme.Ink
import com.playthruu.android.ui.theme.Space

/**
 * Home. What the people you follow have logged, newest first.
 *
 * The whole app's feed when you follow nobody yet, flagged as such —
 * an empty home screen is a worse first impression than a slightly
 * impersonal one, and that is the same call feed-view.js makes.
 */
@Composable
fun FeedScreen(
    userId: String,
    repo: Repository,
    onOpenGame: (String) -> Unit,
    onOpenProfile: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var logs by remember { mutableStateOf<List<GameLog>?>(null) }
    var isFallback by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(userId) {
        runCatching { repo.feed(userId) }
            .onSuccess { (rows, fallback) -> logs = rows; isFallback = fallback }
            .onFailure { error = it.message; logs = emptyList() }
    }

    when {
        logs == null -> Loading(modifier.fillMaxSize().padding(top = Space.s5))
        error != null && logs!!.isEmpty() ->
            EmptyState("Couldn't load the feed: $error", modifier)
        logs!!.isEmpty() -> EmptyState(
            "Nothing here yet. Follow a few people, or log a game of your own.",
            modifier,
        )
        else -> LazyColumn(
            modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 96.dp),
        ) {
            if (isFallback) {
                item {
                    Text(
                        "You're not following anyone yet — here's what the whole app is playing.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Ink.inkFaint,
                        modifier = Modifier.padding(horizontal = Space.s4, vertical = Space.s2),
                    )
                }
            }
            items(logs!!, key = { it.id }) { log ->
                LogCard(
                    log = log,
                    onOpenGame = onOpenGame,
                    onOpenProfile = onOpenProfile,
                )
                HairLine()
            }
        }
    }
}

/**
 * One diary entry: who, which game, what they gave it, and the opening
 * of the review. The poster is the anchor on the left the way it is in
 * the web app's log card — the artwork is what makes a feed scannable.
 */
@Composable
fun LogCard(
    log: GameLog,
    onOpenGame: (String) -> Unit,
    onOpenProfile: (String) -> Unit,
    showAuthor: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val game = log.games
    Row(
        modifier
            .fillMaxWidth()
            .clickable(enabled = game != null) { game?.let { onOpenGame(it.id) } }
            .padding(horizontal = Space.s4, vertical = Space.s3),
        horizontalArrangement = Arrangement.spacedBy(Space.s3),
    ) {
        Poster(
            url = game?.coverUrl,
            title = game?.title ?: "Game",
            modifier = Modifier.width(62.dp),
        )
        Column(Modifier.weight(1f)) {
            if (showAuthor && log.profiles != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.clickable {
                        log.profiles.username?.let(onOpenProfile)
                    },
                ) {
                    Avatar(log.profiles, 20.dp)
                    Text(
                        log.profiles.name,
                        style = MaterialTheme.typography.labelMedium,
                        color = Ink.inkDim,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text("·", color = Ink.inkFaint, fontSize = 11.sp)
                    Text(
                        timeAgo(log.createdAt),
                        style = MaterialTheme.typography.bodySmall,
                        color = Ink.inkFaint,
                    )
                }
                Spacer(Modifier.height(4.dp))
            }

            Text(
                game?.title ?: "Unknown game",
                style = MaterialTheme.typography.titleMedium,
                color = Ink.ink,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )

            Spacer(Modifier.height(4.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Space.s2),
            ) {
                StarRow(log.rating, size = 14.sp, color = Ink.accentBright)
                if (log.status != "played") StatusStamp(log.status)
                game?.releaseYear?.let {
                    Text(
                        it.toString(),
                        style = MaterialTheme.typography.bodySmall,
                        color = Ink.inkFaint,
                    )
                }
            }

            if (!log.review.isNullOrBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    log.review,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Ink.inkDim,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
