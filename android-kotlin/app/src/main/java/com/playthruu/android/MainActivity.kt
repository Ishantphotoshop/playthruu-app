package com.playthruu.android

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playthruu.android.data.Repository
import com.playthruu.android.ui.EmptyState
import com.playthruu.android.ui.Loading
import com.playthruu.android.ui.NavIcons
import com.playthruu.android.ui.screens.ActivityScreen
import com.playthruu.android.ui.screens.AuthScreen
import com.playthruu.android.ui.screens.FeedScreen
import com.playthruu.android.ui.screens.GameScreen
import com.playthruu.android.ui.screens.ProfileScreen
import com.playthruu.android.ui.screens.SearchScreen
import com.playthruu.android.ui.screens.SettingsScreen
import com.playthruu.android.ui.theme.Ink
import com.playthruu.android.ui.theme.PlaythruuTheme
import com.playthruu.android.ui.theme.Unbounded

/**
 * NAVIGATION SHELL — traced from js/components.js navBar()/topBar(),
 * not approximated. The real bottom bar is five ICON-ONLY items (no
 * text labels): Feed, Search, a centred Log button in the brand mark,
 * Messages, Profile. Activity/notifications is NOT a tab — it is
 * reached from the bell in the Feed header, exactly as on the web.
 */
class MainActivity : ComponentActivity() {

    private val askNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            askNotifications.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent { PlaythruuTheme { Root() } }
    }
}

private sealed interface Screen {
    data object Feed : Screen
    data object Search : Screen
    data object Messages : Screen
    data object Activity : Screen
    data class Profile(val username: String?) : Screen
    data class Game(val id: String) : Screen
    data object Settings : Screen
}

@Composable
private fun Root(vm: AppViewModel = viewModel()) {
    val auth by vm.auth.collectAsStateWithLifecycle()
    val profile by vm.profile.collectAsStateWithLifecycle()
    val unread by vm.unread.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val authError by vm.authError.collectAsStateWithLifecycle()
    val repo = remember { Repository() }

    var tab by remember { mutableStateOf<Screen>(Screen.Feed) }
    var pushed by remember { mutableStateOf<Screen?>(null) }

    when (val state = auth) {
        is AppViewModel.Auth.Loading -> Box(
            Modifier.fillMaxSize().background(Ink.bg), contentAlignment = Alignment.Center,
        ) { Loading() }

        is AppViewModel.Auth.SignedOut -> Box(Modifier.fillMaxSize().background(Ink.bg)) {
            AuthScreen(busy, authError, vm::signIn, vm::signUp, vm::dismissAuthError)
        }

        is AppViewModel.Auth.SignedIn -> {
            val userId = state.userId
            val current = pushed ?: tab
            androidx.activity.compose.BackHandler(enabled = pushed != null) { pushed = null }

            Column(Modifier.fillMaxSize().background(Ink.bg)) {
                Box(Modifier.weight(1f)) {
                    when (val screen = current) {
                        is Screen.Feed -> Column(Modifier.fillMaxSize()) {
                            HomeTopBar(unread = unread, onOpenNotifications = { pushed = Screen.Activity })
                            FeedScreen(
                                userId = userId, repo = repo,
                                onOpenGame = { pushed = Screen.Game(it) },
                                onOpenProfile = { pushed = Screen.Profile(it) },
                            )
                        }

                        is Screen.Search -> Column(
                            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars).padding(top = 16.dp),
                        ) {
                            SearchScreen(
                                repo = repo,
                                onOpenGame = { pushed = Screen.Game(it) },
                                onOpenProfile = { pushed = Screen.Profile(it) },
                            )
                        }

                        is Screen.Messages -> Column(
                            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars).padding(top = 16.dp),
                        ) {
                            Text(
                                "Messages", style = MaterialTheme.typography.titleLarge,
                                color = Ink.ink, modifier = Modifier.padding(horizontal = 20.dp),
                            )
                            EmptyState("The messenger has not been ported to native yet. Open the web app or the bundled build to message someone.")
                        }

                        is Screen.Activity -> Column(
                            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars).padding(top = 16.dp),
                        ) {
                            Text(
                                "Notifications", style = MaterialTheme.typography.titleLarge,
                                color = Ink.ink, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                            )
                            ActivityScreen(
                                userId = userId, repo = repo,
                                onOpenProfile = { pushed = Screen.Profile(it) },
                                onOpenGame = { pushed = Screen.Game(it) },
                                onOpened = vm::clearUnread,
                            )
                        }

                        is Screen.Profile -> Column(
                            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars)
                                .padding(top = if (pushed == null) 54.dp else 8.dp),
                        ) {
                            ProfileScreen(
                                username = screen.username, viewerId = userId, repo = repo,
                                onBack = if (pushed != null) ({ pushed = null }) else null,
                                onOpenGame = { pushed = Screen.Game(it) },
                                onOpenSettings = { pushed = Screen.Settings },
                            )
                        }

                        is Screen.Game -> GameScreen(
                            gameId = screen.id, userId = userId, repo = repo,
                            onBack = { pushed = null },
                            onOpenProfile = { pushed = Screen.Profile(it) },
                        )

                        is Screen.Settings -> SettingsScreen(
                            profile = profile, userId = userId, repo = repo,
                            onBack = { pushed = null },
                            onSignOut = { pushed = null; vm.signOut() },
                        )
                    }
                }
                if (pushed == null) {
                    BottomBar(
                        current = tab,
                        onSelect = { tab = it },
                        // The real Log button opens a composer against
                        // whatever game you land on; without that flow
                        // built yet, it takes you to find the game first.
                        onLog = { pushed = Screen.Search },
                    )
                }
            }
        }
    }
}

/**
 * .topbar--home: centred mark + wordmark, the bell absolutely
 * positioned so it never throws the centring off — the same layout
 * trick styles.css itself uses (position:absolute inside a
 * position:sticky parent).
 */
@Composable
private fun HomeTopBar(unread: Long, onOpenNotifications: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(top = 20.dp, bottom = 14.dp),
    ) {
        Row(
            Modifier.align(Alignment.Center),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(NavIcons.Brand, "Playthruu", tint = Color(0xFFF2F5FA), modifier = Modifier.size(28.dp))
            Text(
                "Playthruu", fontFamily = Unbounded, fontWeight = FontWeight.ExtraBold,
                fontSize = 26.sp, letterSpacing = (-0.2).sp, color = Ink.ink,
            )
        }
        Box(Modifier.align(Alignment.CenterEnd).padding(end = 12.dp)) {
            IconButton(onClick = onOpenNotifications) {
                Box {
                    Icon(Icons.Filled.Notifications, "Notifications", tint = Ink.ink)
                    if (unread > 0) {
                        Box(
                            Modifier.align(Alignment.TopEnd).size(9.dp)
                                .background(Ink.accentBright, CircleShape),
                        )
                    }
                }
            }
        }
    }
}

/**
 * .tabbar exactly: surfaceRaised background, hairline top border, five
 * icon-only items at 60%-white resting / full-white active colour, and
 * the centred Log button at 28dp against the others' 25dp.
 */
@Composable
private fun BottomBar(current: Screen, onSelect: (Screen) -> Unit, onLog: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Ink.surfaceRaised)
            .padding(top = 6.dp, bottom = 6.dp)
            .windowInsetsPadding(WindowInsets.navigationBars),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TabIcon(NavIcons.Home, "Feed", current is Screen.Feed) { onSelect(Screen.Feed) }
        TabIcon(NavIcons.Search, "Search", current is Screen.Search) { onSelect(Screen.Search) }
        Box(
            Modifier.size(width = 58.dp, height = 50.dp).clickable(onClick = onLog),
            contentAlignment = Alignment.Center,
        ) {
            Icon(NavIcons.Brand, "Log", tint = Color.White, modifier = Modifier.size(28.dp))
        }
        TabIcon(NavIcons.Message, "Messages", current is Screen.Messages) { onSelect(Screen.Messages) }
        TabIcon(NavIcons.Person, "Profile", current is Screen.Profile) { onSelect(Screen.Profile(null)) }
    }
}

@Composable
private fun TabIcon(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(width = 58.dp, height = 50.dp).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon, label,
            tint = if (active) Color.White else Color.White.copy(alpha = 0.60f),
            modifier = Modifier.size(25.dp),
        )
    }
}
