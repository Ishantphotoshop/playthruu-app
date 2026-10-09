package com.playthruu.android.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.playthruu.android.data.BrowseFilters
import com.playthruu.android.data.Catalog
import com.playthruu.android.data.Igdb
import com.playthruu.android.data.IgdbGame
import com.playthruu.android.data.Profile
import com.playthruu.android.data.Repository
import com.playthruu.android.ui.Avatar
import com.playthruu.android.ui.EmptyState
import com.playthruu.android.ui.Icons
import com.playthruu.android.ui.Loading
import com.playthruu.android.ui.PageTitle
import com.playthruu.android.ui.Poster
import com.playthruu.android.ui.PosterSkeleton
import com.playthruu.android.ui.TabPill
import com.playthruu.android.ui.theme.Ink
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val SORTS = listOf(
    "popular" to "Popular", "trending" to "Trending", "top_rated" to "Highest rated",
    "newest" to "Newest", "recent" to "Recent hits", "anticipated" to "Coming soon",
    "all_time" to "Critics' best", "oldest" to "Oldest", "az" to "A to Z",
)
private val GENRES = listOf(
    "genre:31" to "Adventure", "genre:12" to "RPG", "genre:5" to "Shooter", "genre:15" to "Strategy",
    "genre:9" to "Puzzle", "genre:8" to "Platformer", "genre:10" to "Racing", "genre:14" to "Sport",
    "genre:13" to "Simulator", "genre:4" to "Fighting", "genre:32" to "Indie", "theme:19" to "Horror",
)
private val PLATFORMS = listOf(
    "6" to "PC", "167" to "PS5", "48" to "PS4", "169" to "Xbox Series", "49" to "Xbox One", "130" to "Switch",
)
private val YEARS = listOf(
    "this" to "This year", "last" to "Last year", "2020s" to "2020s", "2010s" to "2010s",
    "2000s" to "2000s", "1990s" to "1990s", "older" to "Older",
)
private val STARS = listOf("5" to "5 stars", "4.5" to "4.5", "4" to "4", "3.5" to "3.5", "3" to "3")

/**
 * Search: type to find games (the web app's own IGDB lookup, plus anything
 * already in the catalogue) or players; with nothing typed it is the Browse
 * grid, which pages as you scroll and narrows with Filters.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SearchScreen(
    repo: Repository,
    onOpenGame: (String) -> Unit,
    onOpenProfile: (String) -> Unit,
    onOpenIgdb: suspend (IgdbGame) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var tab by rememberSaveable { mutableStateOf(0) }
    var query by rememberSaveable { mutableStateOf("") }
    var filters by remember { mutableStateOf(BrowseFilters()) }
    var showFilters by remember { mutableStateOf(false) }

    var games by remember { mutableStateOf<List<IgdbGame>>(emptyList()) }
    var more by remember { mutableStateOf(false) }
    var page by remember { mutableStateOf(1) }
    var loading by remember { mutableStateOf(true) }
    var people by remember { mutableStateOf<List<Profile>>(emptyList()) }

    val typing = query.trim().length >= 2

    // Games: a new search or new filters starts the list over.
    LaunchedEffect(query, filters, tab) {
        if (tab != 0) return@LaunchedEffect
        loading = true; page = 1; more = false
        if (typing) {
            delay(280)
            val local = runCatching { Catalog.localGames(query) }.getOrDefault(emptyList())
            val remote = runCatching { Igdb.search(query.trim(), 30) }.getOrDefault(emptyList())
            val seen = HashSet<String>()
            games = (remote + local).filter { seen.add(Igdb.dedupeKey(it.title)) }
        } else {
            val r = runCatching { Igdb.browse(filters.copy(pageSize = 30), 1) }.getOrNull()
            games = r?.first ?: emptyList(); more = r?.second == true
        }
        loading = false
    }
    LaunchedEffect(query, tab) {
        if (tab != 1) return@LaunchedEffect
        if (!typing) { people = emptyList(); return@LaunchedEffect }
        delay(280)
        people = runCatching { repo.searchProfiles(query) }.getOrDefault(emptyList())
    }

    val grid = rememberLazyGridState()
    val nearEnd by remember {
        derivedStateOf {
            val last = grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= games.size - 6
        }
    }
    LaunchedEffect(nearEnd, more, loading) {
        if (nearEnd && more && !loading && !typing && tab == 0) {
            loading = true
            val next = page + 1
            val r = runCatching { Igdb.browse(filters.copy(pageSize = 30), next) }.getOrNull()
            if (r != null) {
                val have = games.map { it.igdbId }.toHashSet()
                games = games + r.first.filter { have.add(it.igdbId) }
                page = next; more = r.second
            } else more = false
            loading = false
        }
    }

    val open: (IgdbGame) -> Unit = { g -> scope.launch { runCatching { onOpenIgdb(g) } } }
    val activeCount = listOf(
        filters.genre, filters.platform, filters.year, filters.stars,
    ).count { it.isNotEmpty() } + if (filters.sort != "popular") 1 else 0

    Column(Modifier.fillMaxSize().background(Ink.bg)) {
        PageTitle("Search")
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                Modifier.weight(1f).height(44.dp).clip(RoundedCornerShape(999.dp))
                    .background(Ink.surfaceRaised).border(BorderStroke(1.dp, Ink.line), RoundedCornerShape(999.dp))
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Icons.SearchLine, null, tint = Ink.inkDim, modifier = Modifier.size(18.dp))
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) Text("Search games and players", color = Ink.inkFaint, fontSize = 15.sp)
                    BasicTextField(
                        value = query, onValueChange = { query = it }, singleLine = true,
                        textStyle = TextStyle(color = Ink.ink, fontSize = 15.sp),
                        cursorBrush = SolidColor(Ink.accent),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (query.isNotEmpty()) {
                    Icon(
                        Icons.Close, "Clear", tint = Ink.inkDim,
                        modifier = Modifier.size(18.dp).clickable { query = "" },
                    )
                }
            }
            if (tab == 0 && !typing) {
                Box(
                    Modifier.size(44.dp).clip(RoundedCornerShape(999.dp)).background(Ink.surfaceRaised)
                        .border(BorderStroke(1.dp, if (activeCount > 0) Ink.accent else Ink.line), RoundedCornerShape(999.dp))
                        .clickable { showFilters = true },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filter, "Filters", tint = if (activeCount > 0) Ink.accent else Ink.ink, modifier = Modifier.size(18.dp)) }
            }
        }
        TabPill(listOf("Games", "Players"), tab, { tab = it })

        when {
            tab == 1 && !typing -> EmptyState("Type at least two letters to find players.")
            tab == 1 && people.isEmpty() -> EmptyState("Nobody matches “${query.trim()}”.")
            tab == 1 -> LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
                items(people, key = { it.id }) { p ->
                    Row(
                        Modifier.fillMaxWidth().clickable { p.username?.let(onOpenProfile) }.padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Avatar(p, 44.dp)
                        Column {
                            Text(p.name, color = Ink.ink, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                            Text(p.handle, color = Ink.inkDim, fontSize = 13.sp)
                        }
                    }
                }
            }
            loading && games.isEmpty() -> LazyVerticalGrid(
                GridCells.Fixed(3), contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
            ) { items(12) { PosterSkeleton() } }
            games.isEmpty() -> EmptyState(
                if (typing) "No games match “${query.trim()}”." else "Nothing matches those filters.",
            )
            else -> LazyVerticalGrid(
                GridCells.Fixed(3), state = grid,
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                itemsIndexed(games, key = { _, g -> "${g.igdbId}-${g.localId}-${g.title}" }) { _, g ->
                    Box(Modifier.clickable { open(g) }) { Poster(g.coverUrl, g.title, Modifier.fillMaxWidth()) }
                }
            }
        }
    }

    if (showFilters) {
        ModalBottomSheet(onDismissRequest = { showFilters = false }, containerColor = Ink.surfaceRaised) {
            Column(
                Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                FilterGroup("Sort by", SORTS, filters.sort) { filters = filters.copy(sort = it) }
                FilterGroup("Genre", GENRES, filters.genre) { filters = filters.copy(genre = if (filters.genre == it) "" else it) }
                FilterGroup("Platform", PLATFORMS, filters.platform) { filters = filters.copy(platform = if (filters.platform == it) "" else it) }
                FilterGroup("Released", YEARS, filters.year) { filters = filters.copy(year = if (filters.year == it) "" else it) }
                FilterGroup("Average rating", STARS, filters.stars) { filters = filters.copy(stars = if (filters.stars == it) "" else it) }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Chip("Reset", false) { filters = BrowseFilters() }
                    Chip("Show games", true) { showFilters = false }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FilterGroup(title: String, options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, color = Ink.inkDim, fontWeight = FontWeight.ExtraBold, fontSize = 12.sp)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (key, label) -> Chip(label, key == selected) { onPick(key) } }
        }
    }
}

@Composable
private fun Chip(label: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.clip(RoundedCornerShape(999.dp))
            .background(if (on) Ink.accent else Ink.surfaceHigh)
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(label, color = if (on) Ink.bg else Ink.ink, fontWeight = FontWeight.Bold, fontSize = 13.sp)
    }
}
