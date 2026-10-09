package com.playthruu.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.playthruu.android.data.Profile
import com.playthruu.android.ui.theme.Ink
import com.playthruu.android.ui.theme.Unbounded

/**
 * The page furniture, measured off the live web app (390 x 844 viewport)
 * rather than guessed:
 *   .topbar--home   padding 20 16 14, title Unbounded 19 / 800 / -0.01em
 *   .home-tabs      padding 6 16 10; pill 49 high, 1px line, 4px padding
 *   .home-tabs__item 39 high, Unbounded 12.5 / 700
 *   .tabbar         63 high: 1px top line, items 58 x 50, icons 25
 */

/** The centred page title (Home's wordmark, Search, Notifications). */
@Composable
fun PageTitle(title: String, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 14.dp)
            .height(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title,
            fontFamily = Unbounded, fontWeight = FontWeight.ExtraBold,
            fontSize = 19.sp, lineHeight = 24.sp, letterSpacing = (-0.19).sp,
            color = Ink.ink, maxLines = 1,
        )
    }
}

/** The pill of tabs under a page title. Any number of options. */
@Composable
fun TabPill(
    options: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 10.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(999.dp))
                .background(Ink.surfaceRaised)
                .border(BorderStroke(1.dp, Ink.line), RoundedCornerShape(999.dp))
                .padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            options.forEachIndexed { i, label ->
                val active = i == selected
                Box(
                    Modifier
                        .weight(1f)
                        .height(39.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(if (active) Ink.surfaceHigh else Color.Transparent)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { onSelect(i) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label,
                        fontFamily = Unbounded, fontWeight = FontWeight.Bold,
                        fontSize = 12.5.sp, letterSpacing = (-0.125).sp,
                        color = if (active) Ink.ink else Ink.inkDim, maxLines = 1,
                    )
                }
            }
        }
    }
}

/** Title + pill together: the header every tabbed screen shares. */
@Composable
fun TabbedHeader(title: String, options: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    Column(Modifier.background(Ink.bg)) {
        PageTitle(title)
        TabPill(options, selected, onSelect)
    }
}

/** A pushed screen's header: back arrow, Unbounded title, optional right slot. */
@Composable
fun BackHeader(title: String, onBack: () -> Unit, right: (@Composable () -> Unit)? = null) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Ink.bg)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(38.dp)
                .clip(CircleShape)
                .background(Ink.surfaceRaised)
                .border(BorderStroke(1.dp, Ink.line), CircleShape)
                .clickable(onClick = onBack),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Back, "Back", tint = Ink.ink, modifier = Modifier.size(20.dp)) }
        Text(
            title,
            fontFamily = Unbounded, fontWeight = FontWeight.ExtraBold,
            fontSize = 19.sp, letterSpacing = (-0.19).sp, color = Ink.ink,
            maxLines = 1, modifier = Modifier.weight(1f).padding(start = 14.dp),
        )
        right?.invoke()
    }
}

/** What the bar knows about each of its five slots. */
enum class Tab { Feed, Search, Log, Notifications, Profile }

@Composable
fun BottomBar(
    current: Tab?,
    profile: Profile?,
    unread: Long,
    onSelect: (Tab) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Ink.surfaceRaised),
    ) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.line))
        Row(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 6.dp)
                .windowInsetsPadding(WindowInsets.navigationBars),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BarItem(Tab.Feed, current, Icons.HomeOff, Icons.HomeOn, "Feed", onSelect)
            BarItem(Tab.Search, current, Icons.SearchOff, Icons.SearchOn, "Search", onSelect)
            // The plus is an action, white whatever tab you are on.
            Box(
                Modifier.size(width = 58.dp, height = 50.dp).clickable { onSelect(Tab.Log) },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Plus, "Log", tint = Color.White, modifier = Modifier.size(28.dp)) }
            BarItem(Tab.Notifications, current, Icons.BellOff, Icons.BellOn, "Notifications", onSelect, badge = unread)
            // The profile slot is the person's own face, ringed in the
            // accent while it is the open tab.
            Box(
                Modifier.size(width = 58.dp, height = 50.dp).clickable { onSelect(Tab.Profile) },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .size(30.dp)
                        .border(
                            BorderStroke(2.dp, if (current == Tab.Profile) Ink.accent else Color.Transparent),
                            CircleShape,
                        ),
                    contentAlignment = Alignment.Center,
                ) { Avatar(profile, 24.dp) }
            }
        }
    }
}

@Composable
private fun BarItem(
    tab: Tab, current: Tab?, off: ImageVector, on: ImageVector, label: String,
    onSelect: (Tab) -> Unit, badge: Long = 0,
) {
    val active = current == tab
    Box(
        Modifier.size(width = 58.dp, height = 50.dp).clickable { onSelect(tab) },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (active) on else off, label,
            tint = if (active) Ink.accent else Color.White.copy(alpha = 0.60f),
            modifier = Modifier.size(25.dp),
        )
        if (badge > 0) {
            // The bell's count: a small green pill at the icon's top right.
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 2.dp, end = 6.dp)
                    .height(16.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(Ink.accentBright)
                    .padding(horizontal = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (badge > 99) "99+" else badge.toString(),
                    color = Ink.bg, fontSize = 10.5.sp, fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center, lineHeight = 10.5.sp,
                )
            }
        }
    }
}
