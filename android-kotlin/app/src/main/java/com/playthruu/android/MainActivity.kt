package com.playthruu.android

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playthruu.android.data.Repository
import com.playthruu.android.ui.Loading
import com.playthruu.android.ui.TopBar
import com.playthruu.android.ui.screens.ActivityScreen
import com.playthruu.android.ui.screens.AuthScreen
import com.playthruu.android.ui.screens.FeedScreen
import com.playthruu.android.ui.screens.GameScreen
import com.playthruu.android.ui.screens.ProfileScreen
import com.playthruu.android.ui.screens.SearchScreen
import com.playthruu.android.ui.screens.SettingsScreen
import com.playthruu.android.ui.theme.Ink
import com.playthruu.android.ui.theme.PlaythruuTheme

class MainActivity : ComponentActivity() {

    private val askNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* either answer is fine */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Draw behind the bars; Scaffold's insets put the content back in
        // the safe area. Doing it explicitly rather than letting targetSdk
        // 36 do it implicitly keeps the intent visible.
        enableEdgeToEdge()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            askNotifications.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent { PlaythruuTheme { Root() } }
    }
}

/**
 * Where the app is. A sealed hierarchy rather than string routes: the
 * arguments a screen needs travel with it and the compiler checks them,
 * which for five screens is simpler than a navigation graph plus
 * argument parsing on both sides of it.
 */
private sealed interface Screen {
    data object Feed : Screen
    data object Search : Screen
    data object Activity : Screen
    data class Profile(val username: String?) : Screen
    data class Game(val id: String) : Screen
    data object Settings : Screen
}

private val TABS = listOf(Screen.Feed, Screen.Search, Screen.Activity, Screen.Profile(null))

@Composable
private fun Root(vm: AppViewModel = viewModel()) {
    val auth by vm.auth.collectAsStateWithLifecycle()
    val profile by vm.profile.collectAsStateWithLifecycle()
    val unread by vm.unread.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val authError by vm.authError.collectAsStateWithLifecycle()
    val repo = remember { Repository() }

    // A back stack of one screen deep is all this needs: the tabs are
    // roots, and everything else is pushed on top of whichever tab you
    // were on.
    var tab by remember { mutableStateOf<Screen>(Screen.Feed) }
    var pushed by remember { mutableStateOf<Screen?>(null) }

    when (val state = auth) {
        is AppViewModel.Auth.Loading -> Box(
            Modifier.fillMaxSize().background(Ink.bg),
            contentAlignment = Alignment.Center,
        ) { Loading() }

        is AppViewModel.Auth.SignedOut -> Box(Modifier.fillMaxSize().background(Ink.bg)) {
            AuthScreen(
                busy = busy,
                error = authError,
                onSignIn = vm::signIn,
                onSignUp = vm::signUp,
                onErrorShown = vm::dismissAuthError,
            )
        }

        is AppViewModel.Auth.SignedIn -> {
            val userId = state.userId
            val current = pushed ?: tab

            androidx.activity.compose.BackHandler(enabled = pushed != null) { pushed = null }

            Scaffold(
                containerColor = Ink.bg,
                bottomBar = {
                    // Hidden on pushed screens: a game page and a profile
                    // are things you came from somewhere to see, and the
                    // tab bar under them invites losing your place.
                    if (pushed == null) {
                        BottomBar(
                            current = tab,
                            unread = unread,
                            onSelect = { tab = it },
                        )
                    }
                },
            ) { padding ->
                Column(Modifier.fillMaxSize().padding(padding)) {
                    when (val screen = current) {
                        is Screen.Feed -> {
                            TopBar("Playthruu")
                            FeedScreen(
                                userId = userId,
                                repo = repo,
                                onOpenGame = { pushed = Screen.Game(it) },
                                onOpenProfile = { pushed = Screen.Profile(it) },
                            )
                        }

                        is Screen.Search -> {
                            TopBar("Search")
                            SearchScreen(
                                repo = repo,
                                onOpenGame = { pushed = Screen.Game(it) },
                                onOpenProfile = { pushed = Screen.Profile(it) },
                            )
                        }

                        is Screen.Activity -> {
                            TopBar("Notifications")
                            ActivityScreen(
                                userId = userId,
                                repo = repo,
                                onOpenProfile = { pushed = Screen.Profile(it) },
                                onOpenGame = { pushed = Screen.Game(it) },
                                onOpened = vm::clearUnread,
                            )
                        }

                        is Screen.Profile -> ProfileScreen(
                            username = screen.username,
                            viewerId = userId,
                            repo = repo,
                            onBack = if (pushed != null) ({ pushed = null }) else null,
                            onOpenGame = { pushed = Screen.Game(it) },
                            onOpenSettings = { pushed = Screen.Settings },
                        )

                        is Screen.Game -> GameScreen(
                            gameId = screen.id,
                            userId = userId,
                            repo = repo,
                            onBack = { pushed = null },
                            onOpenProfile = { pushed = Screen.Profile(it) },
                        )

                        is Screen.Settings -> SettingsScreen(
                            profile = profile,
                            userId = userId,
                            repo = repo,
                            onBack = { pushed = null },
                            onSignOut = { pushed = null; vm.signOut() },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun BottomBar(current: Screen, unread: Long, onSelect: (Screen) -> Unit) {
    NavigationBar(containerColor = Ink.bgLift, tonalElevation = 0.dp) {
        TABS.forEach { screen ->
            val selected = screen::class == current::class
            NavigationBarItem(
                selected = selected,
                onClick = { onSelect(screen) },
                icon = {
                    val icon = iconFor(screen)
                    if (screen is Screen.Activity && unread > 0) {
                        Box {
                            Icon(icon, label(screen))
                            // A count, not a plain dot: "7 things happened"
                            // is worth knowing before you decide to look.
                            Box(
                                Modifier
                                    .offset(x = 10.dp, y = (-4).dp)
                                    .size(16.dp)
                                    .clip(CircleShape)
                                    .background(Ink.accentBright),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    if (unread > 9) "9+" else unread.toString(),
                                    color = Ink.bg,
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    } else {
                        Icon(icon, label(screen))
                    }
                },
                label = { Text(label(screen), fontSize = 10.sp) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = Ink.accent,
                    selectedTextColor = Ink.accent,
                    unselectedIconColor = Ink.inkFaint,
                    unselectedTextColor = Ink.inkFaint,
                    indicatorColor = Ink.accentDim,
                ),
            )
        }
    }
}

private fun iconFor(screen: Screen): ImageVector = when (screen) {
    is Screen.Search -> Icons.Filled.Search
    is Screen.Activity -> Icons.Filled.Notifications
    is Screen.Profile -> Icons.Filled.Person
    else -> Icons.Filled.Home
}

private fun label(screen: Screen): String = when (screen) {
    is Screen.Search -> "Search"
    is Screen.Activity -> "Activity"
    is Screen.Profile -> "You"
    else -> "Home"
}
