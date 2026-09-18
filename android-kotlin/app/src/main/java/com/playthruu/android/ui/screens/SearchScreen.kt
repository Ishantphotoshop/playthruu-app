package com.playthruu.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.playthruu.android.data.Game
import com.playthruu.android.data.Profile
import com.playthruu.android.data.Repository
import com.playthruu.android.ui.Avatar
import com.playthruu.android.ui.EmptyState
import com.playthruu.android.ui.Loading
import com.playthruu.android.ui.Poster
import com.playthruu.android.ui.Segmented
import com.playthruu.android.ui.theme.Ink
import com.playthruu.android.ui.theme.Space
import kotlinx.coroutines.delay

/**
 * Games and players, in the same two-tab shape as search-view.js.
 *
 * Searching the local catalogue only, which is worth being explicit
 * about: on the web, a miss falls through to IGDB via an edge function
 * and adds the game. That is a real feature and this build does not have
 * it yet, so anything nobody here has logged will not be found.
 */
@Composable
fun SearchScreen(
    repo: Repository,
    onOpenGame: (String) -> Unit,
    onOpenProfile: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var tab by remember { mutableStateOf(0) }
    var query by remember { mutableStateOf("") }
    var games by remember { mutableStateOf<List<Game>>(emptyList()) }
    var people by remember { mutableStateOf<List<Profile>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }

    // Debounced, so typing does not fire a query per keystroke — the
    // delay is cancelled and restarted by LaunchedEffect's own keying.
    LaunchedEffect(query, tab) {
        if (query.trim().length < 2) {
            games = emptyList(); people = emptyList(); searching = false
            return@LaunchedEffect
        }
        searching = true
        delay(280)
        if (tab == 0) {
            games = runCatching { repo.searchGames(query) }.getOrDefault(emptyList())
        } else {
            people = runCatching { repo.searchProfiles(query) }.getOrDefault(emptyList())
        }
        searching = false
    }

    Column(modifier.fillMaxSize().padding(horizontal = Space.s4)) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Search games and players") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            shape = RoundedCornerShape(999.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = Ink.surface,
                unfocusedContainerColor = Ink.surface,
                focusedBorderColor = Ink.accent,
                unfocusedBorderColor = Ink.line,
                focusedTextColor = Ink.ink,
                unfocusedTextColor = Ink.ink,
                cursorColor = Ink.accent,
                focusedPlaceholderColor = Ink.inkFaint,
                unfocusedPlaceholderColor = Ink.inkFaint,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(Space.s3))
        Segmented(
            options = listOf("Games", "Players"),
            selectedIndex = tab,
            onSelect = { tab = it },
        )
        Spacer(Modifier.height(Space.s3))

        when {
            query.trim().length < 2 ->
                EmptyState("Type at least two letters.")
            searching -> Loading()
            tab == 0 && games.isEmpty() ->
                EmptyState("No games here match “${query.trim()}”.")
            tab == 1 && people.isEmpty() ->
                EmptyState("Nobody here matches “${query.trim()}”.")
            tab == 0 -> LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                horizontalArrangement = Arrangement.spacedBy(Space.s2),
                verticalArrangement = Arrangement.spacedBy(Space.s3),
                contentPadding = PaddingValues(bottom = 96.dp),
            ) {
                items(games, key = { it.id }) { game ->
                    Column(Modifier.clickable { onOpenGame(game.id) }) {
                        Poster(game.coverUrl, game.title, Modifier.fillMaxWidth())
                        Spacer(Modifier.height(5.dp))
                        Text(
                            game.title,
                            style = MaterialTheme.typography.bodySmall,
                            color = Ink.ink,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (game.meta.isNotBlank()) {
                            Text(
                                game.meta,
                                style = MaterialTheme.typography.bodySmall,
                                color = Ink.inkFaint,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
            else -> LazyColumn(contentPadding = PaddingValues(bottom = 96.dp)) {
                items(people, key = { it.id }) { person ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { person.username?.let(onOpenProfile) }
                            .padding(vertical = Space.s2),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Space.s3),
                    ) {
                        Avatar(person, 44.dp)
                        Column {
                            Text(
                                person.name,
                                style = MaterialTheme.typography.titleSmall,
                                color = Ink.ink,
                            )
                            Text(
                                person.handle,
                                style = MaterialTheme.typography.bodySmall,
                                color = Ink.inkDim,
                            )
                        }
                    }
                }
            }
        }
    }
}
