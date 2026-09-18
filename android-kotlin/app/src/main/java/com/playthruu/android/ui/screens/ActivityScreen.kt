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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.playthruu.android.data.ActivityItem
import com.playthruu.android.data.ActivityScope
import com.playthruu.android.data.Repository
import com.playthruu.android.ui.Avatar
import com.playthruu.android.ui.EmptyState
import com.playthruu.android.ui.HairLine
import com.playthruu.android.ui.Loading
import com.playthruu.android.ui.Segmented
import com.playthruu.android.ui.StarRow
import com.playthruu.android.ui.timeAgo
import com.playthruu.android.ui.theme.Ink
import com.playthruu.android.ui.theme.Space

/**
 * The activity stream: everything happening in the app except messages.
 *
 * The three tabs split on WHOSE activity it is, which is the split that
 * actually matters — the same as the web app. The filter belongs to the
 * Friends tab alone, because both of its switches are about what ELSE to
 * fold into that stream and neither means anything on a tab already
 * defined as exactly one of those things.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivityScreen(
    userId: String,
    repo: Repository,
    onOpenProfile: (String) -> Unit,
    onOpenGame: (String) -> Unit,
    onOpened: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var scope by remember { mutableStateOf(ActivityScope.FRIENDS) }
    var includeYou by remember { mutableStateOf(false) }
    var includeIncoming by remember { mutableStateOf(false) }
    var rows by remember { mutableStateOf<List<ActivityItem>?>(null) }
    var showFilter by remember { mutableStateOf(false) }

    LaunchedEffect(userId, scope, includeYou, includeIncoming) {
        rows = null
        rows = runCatching {
            repo.activity(userId, scope, includeYou, includeIncoming)
        }.getOrDefault(emptyList())
        // Arriving is the act of reading it, but only the incoming rows
        // have a read state at all — and only they clear the bell.
        onOpened()
    }

    Column(modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s4),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.s2),
        ) {
            Segmented(
                options = ActivityScope.entries.map { it.label },
                selectedIndex = ActivityScope.entries.indexOf(scope),
                onSelect = { scope = ActivityScope.entries[it] },
                modifier = Modifier.weight(1f),
            )
            if (scope == ActivityScope.FRIENDS) {
                val count = (if (includeYou) 1 else 0) + (if (includeIncoming) 1 else 0)
                Box(
                    Modifier
                        .size(42.dp)
                        .clip(CircleShape)
                        .background(Ink.surface)
                        .clickable { showFilter = true },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Outlined.FilterList,
                        contentDescription = "Activity filter",
                        tint = if (count > 0) Ink.accentBright else Ink.inkDim,
                        modifier = Modifier.size(19.dp),
                    )
                }
            }
        }

        Spacer(Modifier.height(Space.s2))

        when {
            rows == null -> Loading()
            rows!!.isEmpty() -> EmptyState(emptyMessage(scope))
            else -> LazyColumn(contentPadding = PaddingValues(bottom = 96.dp)) {
                items(rows!!, key = { it.key }) { item ->
                    ActivityRow(item, userId, onOpenProfile, onOpenGame)
                    HairLine()
                }
            }
        }
    }

    if (showFilter) {
        val sheetState = rememberModalBottomSheetState()
        ModalBottomSheet(
            onDismissRequest = { showFilter = false },
            sheetState = sheetState,
            containerColor = Ink.bgLift,
        ) {
            Column(Modifier.padding(horizontal = Space.s4, vertical = Space.s2)) {
                Text(
                    "Activity filter",
                    style = MaterialTheme.typography.titleMedium,
                    color = Ink.ink,
                )
                Spacer(Modifier.height(Space.s3))
                FilterRow(
                    title = "Include your activity",
                    subtitle = "Your own logs, likes and follows in the Friends stream",
                    checked = includeYou,
                    onChange = { includeYou = it },
                )
                FilterRow(
                    title = "Include incoming activity",
                    subtitle = "Follows, likes and comments aimed at you, from anyone",
                    checked = includeIncoming,
                    onChange = { includeIncoming = it },
                )
                Spacer(Modifier.height(Space.s2))
                Text(
                    "Both off is the pure Friends feed — only the people you follow.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Ink.inkFaint,
                )
                Spacer(Modifier.height(Space.s5))
            }
        }
    }
}

private fun emptyMessage(scope: ActivityScope) = when (scope) {
    ActivityScope.YOU -> "You haven't done anything yet — log a game and it shows up here."
    ActivityScope.INCOMING -> "Nothing aimed at you yet. Follows, likes and comments on your reviews land here."
    ActivityScope.FRIENDS -> "Nothing from the people you follow yet. Try the filter to fold in your own and incoming activity."
}

@Composable
private fun FilterRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onChange(!checked) }
            .padding(vertical = Space.s3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = Ink.ink)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = Ink.inkDim,
            )
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Ink.bg,
                checkedTrackColor = Ink.accent,
                uncheckedThumbColor = Ink.inkDim,
                uncheckedTrackColor = Ink.surfaceHigh,
                uncheckedBorderColor = Ink.line,
            ),
        )
    }
}

/**
 * One row. Regular weight with only the names bolded, so the person is
 * what the eye catches and the verb reads as ordinary sentence text —
 * the same treatment as the web app's .act__text.
 */
@Composable
private fun ActivityRow(
    item: ActivityItem,
    viewerId: String,
    onOpenProfile: (String) -> Unit,
    onOpenGame: (String) -> Unit,
) {
    val bold = SpanStyle(fontWeight = FontWeight.Bold, color = Ink.ink)
    val isYou = item.actor?.id == viewerId
    val who = if (isYou) "You" else (item.actor?.name ?: "Someone")

    val text: AnnotatedString = buildAnnotatedString {
        when (item) {
            is ActivityItem.Logged -> {
                withStyle(bold) { append(who) }
                val verb = when (item.log.status) {
                    "playing" -> " started playing "
                    "backlog" -> " added "
                    "dropped" -> " dropped "
                    else -> " played "
                }
                append(verb)
                withStyle(bold) { append(item.game.title) }
                if (item.log.status == "backlog") {
                    append(if (isYou) " to your backlog" else " to their backlog")
                }
            }
            is ActivityItem.Liked -> {
                withStyle(bold) { append(who) }
                append(" liked ")
                if (item.targetIsViewer) append("your review") else {
                    withStyle(bold) { append(item.owner?.name ?: "someone") }
                    append("'s review")
                }
                item.game?.let { append(" of "); withStyle(bold) { append(it.title) } }
            }
            is ActivityItem.Followed -> {
                withStyle(bold) { append(who) }
                append(" followed ")
                if (item.targetIsViewer) append("you") else withStyle(bold) {
                    append(item.target?.name ?: "someone")
                }
            }
            is ActivityItem.Commented -> {
                withStyle(bold) { append(who) }
                append(" commented on ")
                if (item.targetIsViewer) append("your review") else {
                    withStyle(bold) { append(item.owner?.name ?: "someone") }
                    append("'s review")
                }
                item.game?.let { append(" of "); withStyle(bold) { append(it.title) } }
            }
        }
    }

    val quote = when (item) {
        is ActivityItem.Logged -> item.log.review
        is ActivityItem.Commented -> item.body
        else -> null
    }
    val rating = (item as? ActivityItem.Logged)?.log?.rating
    val gameId = when (item) {
        is ActivityItem.Logged -> item.game.id
        is ActivityItem.Liked -> item.game?.id
        is ActivityItem.Commented -> item.game?.id
        else -> null
    }

    Row(
        Modifier
            .fillMaxWidth()
            .clickable {
                // Prefer the thing it was about; fall back to the person.
                if (gameId != null) onOpenGame(gameId)
                else item.actor?.username?.let(onOpenProfile)
            }
            .padding(horizontal = Space.s4, vertical = 11.dp),
        horizontalArrangement = Arrangement.spacedBy(Space.s3),
    ) {
        Avatar(item.actor, 36.dp)
        Column(Modifier.weight(1f)) {
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium,
                color = Ink.inkDim,
            )
            if (rating != null) {
                Spacer(Modifier.height(3.dp))
                StarRow(rating, size = 12.sp, color = Ink.accentBright)
            }
            if (!quote.isNullOrBlank()) {
                Spacer(Modifier.height(3.dp))
                Text(
                    quote,
                    style = MaterialTheme.typography.bodySmall,
                    color = Ink.inkFaint,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                timeAgo(item.createdAt),
                style = MaterialTheme.typography.bodySmall,
                color = Ink.inkFaint,
                maxLines = 1,
            )
            if (item.unread) {
                Spacer(Modifier.height(5.dp))
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(Ink.accentBright)
                )
            }
        }
    }
}
