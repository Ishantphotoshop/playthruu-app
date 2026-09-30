package com.playthruu.android

/**
 * BACK STACK. Navigation used to be a bottom-bar tab plus ONE `pushed`
 * slot, so opening a second screen from a pushed one overwrote it (Back
 * from C skipped B and went straight to the tab), and with nothing pushed
 * Back had no handler at all and closed the app from any tab. It is now a
 * list of entries, one per navigation, like the web app's history: Back
 * (system gesture or an in-app arrow) pops exactly one, and the app only
 * exits when the first entry is all that is left.
 *
 * Kept free of Compose so the rules can be tested on the JVM
 * (NavStateTest); MainActivity renders it.
 */
internal sealed interface Screen {
    data object Feed : Screen
    data object Search : Screen
    data object Messages : Screen
    data object Activity : Screen
    data class Profile(val username: String?) : Screen
    data class Game(val id: String) : Screen
    data object Settings : Screen
}

/**
 * One navigation. `id` is unique for the life of the stack (never reused
 * after a pop, since it keys the entry's composition and saved state).
 * `tab` marks entries opened from the bottom bar: they show the bar and no
 * back arrow. Switching tabs is a navigation too, so Back walks back
 * through them, exactly as it does on the web.
 */
internal data class Entry(val id: Long, val screen: Screen, val tab: Boolean)

internal data class NavState(val entries: List<Entry>, val nextId: Long) {
    val top: Entry get() = entries.last()
    val canGoBack: Boolean get() = entries.size > 1

    /** Opens a screen on top. Tapping twice is one navigation, not two copies. */
    fun push(screen: Screen): NavState =
        if (top.screen == screen) this
        else NavState(entries + Entry(nextId, screen, tab = false), nextId + 1)

    /** A bottom-bar tap. The tab you are already on adds nothing. */
    fun selectTab(screen: Screen): NavState =
        if (top.tab && top.screen == screen) this
        else NavState(entries + Entry(nextId, screen, tab = true), nextId + 1)

    /** Back: the entry underneath, exactly. Nothing to pop on the first entry. */
    fun pop(): NavState = if (canGoBack) copy(entries = entries.dropLast(1)) else this

    /** Survives rotation and the process being reclaimed (see StackSaver). */
    fun encode(): ArrayList<String> =
        arrayListOf(nextId.toString()).apply {
            entries.forEach { add("${it.id}|${if (it.tab) 1 else 0}|${it.screen.encode()}") }
        }

    companion object {
        val Initial = NavState(listOf(Entry(0L, Screen.Feed, tab = true)), nextId = 1L)

        fun decode(saved: List<String>): NavState? {
            val nextId = saved.firstOrNull()?.toLongOrNull() ?: return null
            val entries = saved.drop(1).mapNotNull { line ->
                val parts = line.split('|', limit = 3)
                val id = parts.getOrNull(0)?.toLongOrNull()
                val screen = parts.getOrNull(2)?.let(::decodeScreen)
                if (id == null || screen == null) null else Entry(id, screen, parts[1] == "1")
            }
            if (entries.isEmpty()) return null
            return NavState(entries, maxOf(nextId, entries.maxOf { it.id } + 1))
        }
    }
}

private fun Screen.encode(): String = when (this) {
    Screen.Feed -> "feed"
    Screen.Search -> "search"
    Screen.Messages -> "messages"
    Screen.Activity -> "activity"
    Screen.Settings -> "settings"
    is Screen.Profile -> "profile:" + (username ?: "")
    is Screen.Game -> "game:$id"
}

private fun decodeScreen(code: String): Screen? {
    val arg = code.substringAfter(':', "")
    return when (code.substringBefore(':')) {
        "feed" -> Screen.Feed
        "search" -> Screen.Search
        "messages" -> Screen.Messages
        "activity" -> Screen.Activity
        "settings" -> Screen.Settings
        "profile" -> Screen.Profile(arg.ifEmpty { null })
        "game" -> if (arg.isNotEmpty()) Screen.Game(arg) else null
        else -> null
    }
}
