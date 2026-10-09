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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.playthruu.android.data.BrowseFilters
import com.playthruu.android.data.Catalog
import com.playthruu.android.data.GameLog
import com.playthruu.android.data.Igdb
import com.playthruu.android.data.IgdbGame
import com.playthruu.android.data.NewsRow
import com.playthruu.android.data.Repository
import com.playthruu.android.ui.Avatar
import com.playthruu.android.ui.EmptyState
import com.playthruu.android.ui.Loading
import com.playthruu.android.ui.Poster
import com.playthruu.android.ui.PosterSkeleton
import com.playthruu.android.ui.StarRow
import com.playthruu.android.ui.TabbedHeader
import com.playthruu.android.ui.theme.Ink
import com.playthruu.android.ui.timeAgo
import kotlinx.coroutines.launch

private val STRIP_W = 104.dp

/**
 * Home: the PlayThruu title over a Feed / News pill. Feed is Trending
 * now, your friends' recent activity, what they are playing, and a batch
 * of games to try; News is the published stories.
 */
@Composable
fun HomeScreen(
    userId: String,
    repo: Repository,
    onOpenGame: (String) -> Unit,
    onOpenProfile: (String) -> Unit,
    onOpenIgdb: suspend (IgdbGame) -> Unit,
    onOpenNews: (String) -> Unit,
) {
    var tab by rememberSaveable { mutableStateOf(0) }
    Column(Modifier.fillMaxSize().background(Ink.bg)) {
        TabbedHeader("PlayThruu", listOf("Feed", "News"), tab) { tab = it }
        Box(Modifier.weight(1f)) {
            if (tab == 0) FeedPane(userId, onOpenGame, onOpenProfile, onOpenIgdb)
            else NewsPane(onOpenNews)
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text, color = Ink.ink, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp,
        modifier = Modifier.padding(horizontal = 16.dp).padding(top = 22.dp, bottom = 10.dp),
    )
}

@Composable
private fun IgdbStrip(games: List<IgdbGame>?, onTap: (IgdbGame) -> Unit) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (games == null) {
            items(6) { PosterSkeleton(Modifier.width(STRIP_W)) }
        } else {
            items(games, key = { it.igdbId }) { g ->
                Box(Modifier.width(STRIP_W).clickable { onTap(g) }) {
                    Poster(g.coverUrl, g.title, Modifier.fillMaxWidth())
                }
            }
        }
    }
}

@Composable
private fun FeedPane(
    userId: String,
    onOpenGame: (String) -> Unit,
    onOpenProfile: (String) -> Unit,
    onOpenIgdb: suspend (IgdbGame) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var trending by remember { mutableStateOf<List<IgdbGame>?>(null) }
    var recent by remember { mutableStateOf<List<GameLog>?>(null) }
    var playing by remember { mutableStateOf<List<GameLog>?>(null) }
    var bored by remember { mutableStateOf<List<IgdbGame>?>(null) }
    var batch by remember { mutableStateOf(0) }

    LaunchedEffect(userId) {
        launch { trending = runCatching { Igdb.trending(12) }.getOrDefault(emptyList()) }
        launch { recent = runCatching { Catalog.friendsLogs(userId, "played").first }.getOrDefault(emptyList()) }
        launch { playing = runCatching { Catalog.friendsLogs(userId, "playing").first }.getOrDefault(emptyList()) }
    }
    LaunchedEffect(batch) {
        bored = null
        bored = runCatching {
            Igdb.browse(BrowseFilters(sort = "popular", pageSize = 12), batch + 1).first
        }.getOrDefault(emptyList())
    }

    val open: (IgdbGame) -> Unit = { g -> scope.launch { runCatching { onOpenIgdb(g) } } }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        SectionTitle("Trending now")
        IgdbStrip(trending, open)

        SectionTitle("Friends' recent activity")
        LogStrip(recent, onOpenGame, onOpenProfile)

        SectionTitle("Currently playing")
        LogStrip(playing, onOpenGame, onOpenProfile)

        SectionTitle("Bored? Try these")
        IgdbStrip(bored, open)
        Box(
            Modifier.padding(horizontal = 16.dp).padding(top = 12.dp)
                .clip(RoundedCornerShape(999.dp)).background(Ink.surfaceRaised)
                .clickable { batch += 1 }.padding(horizontal = 16.dp, vertical = 9.dp),
        ) { Text("Show me more", color = Ink.ink, fontWeight = FontWeight.Bold, fontSize = 13.sp) }
    }
}

@Composable
private fun LogStrip(
    logs: List<GameLog>?,
    onOpenGame: (String) -> Unit,
    onOpenProfile: (String) -> Unit,
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (logs == null) {
            items(4) { PosterSkeleton(Modifier.width(STRIP_W)) }
        } else if (logs.isEmpty()) {
            item { Text("Nothing here yet.", color = Ink.inkFaint, fontSize = 13.sp) }
        } else {
            items(logs, key = { it.id }) { log ->
                Column(Modifier.width(STRIP_W), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Poster(
                        log.games?.coverUrl, log.games?.title ?: "Game",
                        Modifier.fillMaxWidth().clickable(enabled = log.games != null) { onOpenGame(log.games!!.id) },
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.clickable { log.profiles?.username?.let(onOpenProfile) },
                    ) {
                        Avatar(log.profiles, 24.dp)
                        Text(
                            log.profiles?.name ?: "", color = Ink.inkDim, fontSize = 12.sp, lineHeight = 15.6.sp,
                            fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    StarRow(log.rating, starWidth = 12.dp)
                }
            }
        }
    }
}

@Composable
private fun NewsPane(onOpenNews: (String) -> Unit) {
    var rows by remember { mutableStateOf<List<NewsRow>?>(null) }
    LaunchedEffect(Unit) { rows = runCatching { Catalog.news() }.getOrDefault(emptyList()) }
    val list = rows
    when {
        list == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { Loading() }
        list.isEmpty() -> EmptyState("No stories yet.")
        else -> LazyColumn(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            items(list, key = { it.slug }) { n ->
                Column(Modifier.fillMaxWidth().clickable { onOpenNews(n.slug) }) {
                    if (!n.imageUrl.isNullOrBlank()) {
                        AsyncImage(
                            n.imageUrl, null, contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxWidth().height(180.dp).clip(RoundedCornerShape(8.dp)),
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                    Text(n.title, color = Ink.ink, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, maxLines = 3)
                    Text(timeAgo(n.updatedAt), color = Ink.inkFaint, fontSize = 12.sp)
                }
            }
        }
    }
}
