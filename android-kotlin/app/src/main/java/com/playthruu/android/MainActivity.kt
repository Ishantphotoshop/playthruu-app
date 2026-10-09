package com.playthruu.android

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
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
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
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
import com.playthruu.android.ui.screens.HomeScreen
import com.playthruu.android.ui.BackHeader
import com.playthruu.android.ui.BottomBar
import com.playthruu.android.ui.PageTitle
import com.playthruu.android.ui.Tab
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

/** The stack survives rotation and the process being reclaimed. */
private val StackSaver = Saver<NavState, ArrayList<String>>(
    save = { it.encode() },
    restore = { NavState.decode(it) },
)

/**
 * How many of the newest entries stay composed. Those come back on Back
 * exactly as they were left: scroll, typed text, tabs, loaded data, with
 * no refetch. Deeper ones are dropped from composition but keep their
 * rememberSaveable state (scroll positions) through the state holder, and
 * reload their data when Back reaches them.
 */
private const val KEEP_ALIVE = 8

@Composable
private fun Root(vm: AppViewModel = viewModel()) {
    val auth by vm.auth.collectAsStateWithLifecycle()
    val profile by vm.profile.collectAsStateWithLifecycle()
    val unread by vm.unread.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val authError by vm.authError.collectAsStateWithLifecycle()
    val repo = remember { Repository() }

    when (val state = auth) {
        is AppViewModel.Auth.Loading -> Box(
            Modifier.fillMaxSize().background(Ink.bg), contentAlignment = Alignment.Center,
        ) { Loading() }

        is AppViewModel.Auth.SignedOut -> Box(Modifier.fillMaxSize().background(Ink.bg)) {
            AuthScreen(busy, authError, vm::signIn, vm::signUp, vm::dismissAuthError)
        }

        // Keyed by account: signing in as someone else starts a fresh stack.
        is AppViewModel.Auth.SignedIn -> key(state.userId) {
            SignedInShell(state.userId, profile, unread, repo, vm)
        }
    }
}

@Composable
private fun SignedInShell(
    userId: String,
    profile: com.playthruu.android.data.Profile?,
    unread: Long,
    repo: Repository,
    vm: AppViewModel,
) {
    var nav by rememberSaveable(stateSaver = StackSaver) { mutableStateOf(NavState.Initial) }
    val holder = rememberSaveableStateHolder()
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current

    // The screen being left stays composed underneath, so a focused text
    // field there would keep the keyboard up over the next screen.
    fun settle() {
        focus.clearFocus(force = true)
        keyboard?.hide()
    }
    fun go(next: NavState) {
        if (next === nav) return // a repeat tap: nothing to do
        settle()
        nav = next
    }
    fun pop() {
        if (!nav.canGoBack) return
        val gone = nav.top
        go(nav.pop())
        holder.removeState(gone.id)
    }

    val top = nav.top
    // Only when there is somewhere to go back to; on the first entry the
    // system handles Back and the app closes, as Android expects. Sheets
    // (ModalBottomSheet) take Back first on their own, above this.
    BackHandler(enabled = nav.canGoBack) { pop() }

    Column(Modifier.fillMaxSize().background(Ink.bg)) {
        Box(Modifier.weight(1f)) {
            for (entry in nav.entries.takeLast(KEEP_ALIVE)) {
                key(entry.id) {
                    holder.SaveableStateProvider(entry.id) {
                        KeptEntry(visible = entry.id == top.id) {
                            EntryContent(
                                entry = entry, userId = userId, profile = profile, unread = unread,
                                repo = repo, vm = vm, push = { go(nav.push(it)) }, pop = { pop() },
                            )
                        }
                    }
                }
            }
        }
        if (top.tab) {
            BottomBar(
                current = top.screen.asTab(),
                profile = profile,
                unread = unread,
                onSelect = { t ->
                    when (t) {
                        Tab.Feed -> go(nav.selectTab(Screen.Feed))
                        Tab.Search -> go(nav.selectTab(Screen.Search))
                        Tab.Log -> go(nav.push(Screen.Search))
                        Tab.Notifications -> go(nav.selectTab(Screen.Notifications))
                        Tab.Profile -> go(nav.selectTab(Screen.Profile(null)))
                    }
                },
            )
        }
    }
}

private fun Screen.asTab(): Tab? = when (this) {
    Screen.Feed -> Tab.Feed
    Screen.Search -> Tab.Search
    Screen.Notifications -> Tab.Notifications
    is Screen.Profile -> if (username == null) Tab.Profile else null
    else -> null
}

/**
 * Keeps an entry composed (its state, loaded data and scroll all stay
 * alive) but lays out and draws only the one on top. A hidden entry is
 * neither measured nor placed, so it costs no layout, draws nothing and
 * cannot be touched.
 */
@Composable
private fun KeptEntry(visible: Boolean, content: @Composable () -> Unit) {
    Layout(content) { measurables, constraints ->
        if (!visible) return@Layout layout(0, 0) {}
        val placeables = measurables.map { it.measure(constraints) }
        layout(constraints.maxWidth, constraints.maxHeight) {
            placeables.forEach { it.placeRelative(0, 0) }
        }
    }
}

@Composable
private fun EntryContent(
    entry: Entry,
    userId: String,
    profile: com.playthruu.android.data.Profile?,
    unread: Long,
    repo: Repository,
    vm: AppViewModel,
    push: (Screen) -> Unit,
    pop: () -> Unit,
) {
    when (val screen = entry.screen) {
        is Screen.Feed -> HomeScreen(
            userId = userId, repo = repo,
            onOpenGame = { push(Screen.Game(it)) },
            onOpenProfile = { push(Screen.Profile(it)) },
            onOpenIgdb = { g ->
                val row = com.playthruu.android.data.Catalog.addGame(g, userId)
                push(Screen.Game(row.id))
            },
            onOpenNews = { push(Screen.News(it)) },
        )

        is Screen.Search -> Column(
            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars).padding(top = 16.dp),
        ) {
            SearchScreen(
                repo = repo,
                onOpenGame = { push(Screen.Game(it)) },
                onOpenProfile = { push(Screen.Profile(it)) },
            )
        }

        is Screen.Log, is Screen.News -> Column(Modifier.fillMaxSize()) {
            BackHeader(if (screen is Screen.News) "News" else "Log a game", pop)
            EmptyState("Coming to the native app next.")
        }

        is Screen.Notifications -> Column(Modifier.fillMaxSize()) {
            PageTitle("Notifications")
            ActivityScreen(
                userId = userId, repo = repo,
                onOpenProfile = { push(Screen.Profile(it)) },
                onOpenGame = { push(Screen.Game(it)) },
                onOpened = vm::clearUnread,
            )
        }

        is Screen.Profile -> Column(
            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars)
                .padding(top = if (entry.tab) 54.dp else 8.dp),
        ) {
            ProfileScreen(
                username = screen.username, viewerId = userId, repo = repo,
                onBack = if (entry.tab) null else pop,
                onOpenGame = { push(Screen.Game(it)) },
                onOpenSettings = { push(Screen.Settings) },
            )
        }

        is Screen.Game -> GameScreen(
            gameId = screen.id, userId = userId, repo = repo,
            onBack = pop,
            onOpenProfile = { push(Screen.Profile(it)) },
        )

        is Screen.Settings -> SettingsScreen(
            profile = profile, userId = userId, repo = repo,
            onBack = pop,
            // Signing out swaps the whole shell for the sign-in screen,
            // which drops this stack with it.
            onSignOut = { vm.signOut() },
        )
    }
}
