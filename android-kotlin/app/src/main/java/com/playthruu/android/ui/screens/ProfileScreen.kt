package com.playthruu.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.playthruu.android.data.GameLog
import com.playthruu.android.data.Profile
import com.playthruu.android.data.Repository
import com.playthruu.android.ui.Avatar
import com.playthruu.android.ui.EmptyState
import com.playthruu.android.ui.Loading
import com.playthruu.android.ui.Poster
import com.playthruu.android.ui.Segmented
import com.playthruu.android.ui.StarRow
import com.playthruu.android.ui.theme.Ink
import com.playthruu.android.ui.theme.Space
import com.playthruu.android.ui.theme.Unbounded
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * A profile — your own or somebody else's. The same screen either way,
 * which is what keeps the two from drifting; what changes is the action
 * in the corner (settings vs follow) and nothing else.
 */
@Composable
fun ProfileScreen(
    username: String?,
    viewerId: String,
    repo: Repository,
    onBack: (() -> Unit)?,
    onOpenGame: (String) -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var profile by remember { mutableStateOf<Profile?>(null) }
    var logs by remember { mutableStateOf<List<GameLog>>(emptyList()) }
    var following by remember { mutableStateOf<Boolean?>(null) }
    var loading by remember { mutableStateOf(true) }
    var tab by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(username, viewerId) {
        loading = true
        val p = if (username == null) repo.profile(viewerId).also { }
        else runCatching { repo.profileByUsername(username) }.getOrNull()
        profile = p
        if (p != null) {
            logs = runCatching { repo.logsForUser(p.id) }.getOrDefault(emptyList())
            following = if (p.id == viewerId) null
            else runCatching { repo.isFollowing(viewerId, p.id) }.getOrNull()
        }
        loading = false
    }

    if (loading) { Loading(modifier.fillMaxSize()); return }
    val p = profile ?: run { EmptyState("That profile isn't here.", modifier); return }
    val isMe = p.id == viewerId

    val diary = logs.filter { it.status == "played" || it.status == "dropped" }
    val playing = logs.filter { it.status == "playing" }
    val backlog = logs.filter { it.status == "backlog" }
    val shown = when (tab) { 1 -> playing; 2 -> backlog; else -> diary }

    val rated = logs.mapNotNull { it.rating }
    val average = if (rated.isEmpty()) null else rated.average()

    Column(modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s2, vertical = Space.s2),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink.ink)
                }
            }
            Spacer(Modifier.weight(1f))
            if (isMe) {
                IconButton(onClick = onOpenSettings) {
                    Icon(Icons.Outlined.Settings, "Settings", tint = Ink.ink)
                }
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s4),
            horizontalArrangement = Arrangement.spacedBy(Space.s3),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(p, 72.dp)
            Column(Modifier.weight(1f)) {
                Text(
                    p.name,
                    fontFamily = Unbounded,
                    fontWeight = FontWeight.Bold,
                    fontSize = 19.sp,
                    letterSpacing = (-0.2).sp,
                    color = Ink.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(p.handle, style = MaterialTheme.typography.bodySmall, color = Ink.inkDim)
                if (!p.bio.isNullOrBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        p.bio,
                        style = MaterialTheme.typography.bodySmall,
                        color = Ink.inkDim,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }

        if (!isMe && following != null) {
            Spacer(Modifier.height(Space.s3))
            Button(
                onClick = {
                    val next = !(following ?: false)
                    following = next
                    scope.launch {
                        runCatching {
                            if (next) repo.follow(viewerId, p.id) else repo.unfollow(viewerId, p.id)
                        }.onFailure { following = !next }
                    }
                },
                shape = RoundedCornerShape(999.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (following == true) Ink.surfaceHigh else Ink.accent,
                    contentColor = if (following == true) Ink.ink else Ink.bg,
                ),
                modifier = Modifier.fillMaxWidth().padding(horizontal = Space.s4),
            ) {
                Text(
                    if (following == true) "Following" else "Follow",
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                )
            }
        }

        Spacer(Modifier.height(Space.s4))
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s4),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Stat("Games", logs.map { it.gameId }.distinct().size.toString())
            Stat("Reviews", logs.count { !it.review.isNullOrBlank() }.toString())
            Stat(
                "Average",
                average?.let { ((it * 10).roundToInt() / 10.0).toString() } ?: "–",
            )
        }

        Spacer(Modifier.height(Space.s4))
        Segmented(
            options = listOf("Diary", "Playing", "Backlog"),
            selectedIndex = tab,
            onSelect = { tab = it },
            modifier = Modifier.padding(horizontal = Space.s4),
        )
        Spacer(Modifier.height(Space.s3))

        if (shown.isEmpty()) {
            EmptyState(
                when (tab) {
                    1 -> "Nothing in progress."
                    2 -> "Nothing in the backlog."
                    else -> "No games logged yet."
                }
            )
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                horizontalArrangement = Arrangement.spacedBy(Space.s2),
                verticalArrangement = Arrangement.spacedBy(Space.s3),
                contentPadding = PaddingValues(start = Space.s4, end = Space.s4, bottom = 96.dp),
            ) {
                items(shown, key = { it.id }) { log ->
                    Column(Modifier.clickable { log.games?.let { onOpenGame(it.id) } }) {
                        Poster(log.games?.coverUrl, log.games?.title ?: "Game", Modifier.fillMaxWidth())
                        if (log.rating != null) {
                            Spacer(Modifier.height(4.dp))
                            StarRow(log.rating, size = 11.sp, color = Ink.accentBright)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleLarge, color = Ink.ink)
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = Ink.inkFaint,
        )
    }
}
