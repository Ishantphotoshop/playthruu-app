package com.playthruu.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class NavStateTest {

    private fun NavState.screens() = entries.map { it.screen }

    @Test
    fun backWalksEveryLevelInOrder() {
        // Home -> A -> B -> C -> D; Back must go D -> C -> B -> A -> Home, never D -> Home.
        var nav = NavState.Initial
            .push(Screen.Game("a"))
            .push(Screen.Profile("b"))
            .push(Screen.Game("c"))
            .push(Screen.Settings)
        assertEquals(Screen.Settings, nav.top.screen)
        nav = nav.pop(); assertEquals(Screen.Game("c"), nav.top.screen)
        nav = nav.pop(); assertEquals(Screen.Profile("b"), nav.top.screen)
        nav = nav.pop(); assertEquals(Screen.Game("a"), nav.top.screen)
        nav = nav.pop(); assertEquals(Screen.Feed, nav.top.screen)
        assertFalse(nav.canGoBack)
    }

    @Test
    fun backRevealsTheSameEntryNotANewOne() {
        val home = NavState.Initial.selectTab(Screen.Search)
        val searchEntry = home.top
        val back = home.push(Screen.Game("x")).pop()
        assertSame(searchEntry, back.top) // same id: its composition and state are what come back
    }

    @Test
    fun tabSwitchesAreHistoryToo() {
        var nav = NavState.Initial
            .selectTab(Screen.Search)
            .push(Screen.Game("g"))
        nav = nav.pop(); assertEquals(Screen.Search, nav.top.screen); assertTrue(nav.top.tab)
        nav = nav.pop(); assertEquals(Screen.Feed, nav.top.screen)
        assertFalse("first entry: Back is the system's (app exits)", nav.canGoBack)
    }

    @Test
    fun repeatedTapsAddOneEntry() {
        val once = NavState.Initial.push(Screen.Game("g"))
        assertSame(once, once.push(Screen.Game("g")))
        val tab = NavState.Initial.selectTab(Screen.Search)
        assertSame(tab, tab.selectTab(Screen.Search))
        assertSame(NavState.Initial, NavState.Initial.selectTab(Screen.Feed))
    }

    @Test
    fun popOnTheFirstEntryDoesNothing() {
        assertSame(NavState.Initial, NavState.Initial.pop())
    }

    @Test
    fun idsAreNeverReusedAfterAPop() {
        val a = NavState.Initial.push(Screen.Game("a"))
        val poppedId = a.top.id
        val b = a.pop().push(Screen.Game("b"))
        assertTrue(b.top.id != poppedId)
        assertEquals(b.entries.size, b.entries.map { it.id }.toSet().size)
    }

    @Test
    fun survivesSaveAndRestore() {
        val nav = NavState.Initial
            .selectTab(Screen.Profile(null))
            .push(Screen.Settings)
            .pop()
            .push(Screen.Profile("someone"))
            .push(Screen.Game("id-1"))
        val restored = NavState.decode(nav.encode())
        assertEquals(nav, restored)
        assertEquals(listOf(Screen.Feed, Screen.Profile(null), Screen.Profile("someone"), Screen.Game("id-1")), restored!!.screens())
    }

    @Test
    fun corruptSavedStateFallsBackToNothing() {
        assertNull(NavState.decode(emptyList()))
        assertNull(NavState.decode(listOf("x")))
        assertNull(NavState.decode(listOf("3", "junk")))
    }
}
