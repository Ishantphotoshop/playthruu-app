package com.playthruu.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.playthruu.android.data.Igdb
import com.playthruu.android.data.IgdbGame
import com.playthruu.android.ui.BackHeader
import com.playthruu.android.ui.EmptyState
import com.playthruu.android.ui.Loading
import com.playthruu.android.ui.Poster
import com.playthruu.android.ui.theme.Ink
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The + button: name the game, tap it, and its page opens ready to log
 * (rating, status and review live on the game page).
 */
@Composable
fun LogPickerScreen(onBack: () -> Unit, onOpenIgdb: suspend (IgdbGame) -> Unit) {
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<IgdbGame>?>(null) }

    LaunchedEffect(query) {
        if (query.trim().length < 2) { results = null; return@LaunchedEffect }
        delay(280)
        results = runCatching { Igdb.search(query.trim(), 20) }.getOrDefault(emptyList())
    }

    Column(Modifier.fillMaxSize().background(Ink.bg)) {
        BackHeader("Name of Game", onBack)
        Box(
            Modifier.padding(horizontal = 16.dp).fillMaxWidth().height(44.dp)
                .clip(RoundedCornerShape(999.dp)).background(Ink.surfaceRaised).padding(horizontal = 16.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (query.isEmpty()) Text("Type the game's name", color = Ink.inkFaint, fontSize = 15.sp)
            BasicTextField(
                query, { query = it }, singleLine = true,
                textStyle = TextStyle(color = Ink.ink, fontSize = 15.sp),
                cursorBrush = SolidColor(Ink.accent), modifier = Modifier.fillMaxWidth(),
            )
        }
        when {
            query.trim().length < 2 -> EmptyState("Start typing and pick the game you played.")
            results == null -> Box(Modifier.fillMaxSize(), Alignment.TopCenter) { Loading() }
            results!!.isEmpty() -> EmptyState("No games match.")
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(results!!, key = { "${it.igdbId}-${it.title}" }) { g ->
                    Row(
                        Modifier.fillMaxWidth().clickable { scope.launch { runCatching { onOpenIgdb(g) } } },
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Poster(g.coverUrl, g.title, Modifier.width(54.dp))
                        Column(Modifier.weight(1f).align(Alignment.CenterVertically)) {
                            Text(g.title, color = Ink.ink, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(
                                listOfNotNull(g.releaseYear?.toString(), g.platform.takeIf { it.isNotBlank() }).joinToString(" · "),
                                color = Ink.inkDim, fontSize = 12.sp, maxLines = 1,
                            )
                        }
                    }
                }
            }
        }
    }
}
