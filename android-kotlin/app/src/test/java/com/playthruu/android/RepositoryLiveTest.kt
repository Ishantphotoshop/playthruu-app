package com.playthruu.android

import com.playthruu.android.data.ActivityScope
import com.playthruu.android.data.Repository
import com.playthruu.android.ui.timeAgo
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * These run against the REAL project, with the anon key, exactly as the
 * app does.
 *
 * That is the point. The risky part of this rewrite is not the Kotlin —
 * the compiler checks that. It is whether the hand-written column lists
 * and foreign-key constraint names in the PostgREST selects are correct,
 * and a wrong one of those fails at runtime, on a screen, as an empty
 * list with no error. Asking the actual database is the only thing that
 * proves them.
 *
 * Everything here reads public data only, and nothing writes.
 */
class RepositoryLiveTest {

    // A Postgrest-only client, not the app's. Auth's default session
    // manager is backed by SharedPreferences, which does not exist in a
    // JVM unit test — and these tests read public data, so there is
    // nothing for it to do here anyway. Repository takes the client as a
    // parameter precisely so this substitution needs no production code.
    private val readOnlyClient = io.github.jan.supabase.createSupabaseClient(
        supabaseUrl = "https://kpgjuuplpgilupogpezc.supabase.co",
        supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
            "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwZ2p1dXBscGdpbHVwb2dwZXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMDgwOTAsImV4cCI6MjEwMTU4NDA5MH0." +
            "39cjFgmgBquORUSY00vWOeuAhI3nPYIOAhQhREq9OF8",
    ) {
        install(io.github.jan.supabase.postgrest.Postgrest)
        defaultSerializer = io.github.jan.supabase.serializer.KotlinXSerializer(
            kotlinx.serialization.json.Json { ignoreUnknownKeys = true; explicitNulls = false }
        )
    }

    private val repo = Repository(readOnlyClient)

    @Test
    fun `games select parses`() = runBlocking {
        val games = repo.searchGames("the")
        // The catalogue has plenty of titles containing "the"; an empty
        // result here means the query or the model is wrong, not that the
        // database is empty.
        assertTrue("expected some games back, got ${games.size}", games.isNotEmpty())
        val game = games.first()
        assertTrue("a game should have a title", game.title.isNotBlank())
        println("games: ${games.size}, first = ${game.title} (${game.meta})")
    }

    @Test
    fun `profiles select parses`() = runBlocking {
        val people = repo.searchProfiles("a")
        println("profiles matching 'a': ${people.size}")
        people.take(3).forEach { println("  ${it.name} ${it.handle} initials=${it.initials}") }
    }

    /**
     * The one most likely to be wrong: logs embeds BOTH games and
     * profiles, and profiles is reachable from logs by more than one
     * path, so the constraint name has to be spelled out or PostgREST
     * refuses the query outright.
     */
    @Test
    fun `logs select with both embeds parses`() = runBlocking {
        val games = repo.searchGames("the")
        if (games.isEmpty()) return@runBlocking
        var checked = 0
        for (game in games.take(8)) {
            val logs = repo.logsForGame(game.id)
            checked += logs.size
            logs.take(2).forEach {
                println("log on ${game.title}: rating=${it.rating} by=${it.profiles?.name} game=${it.games?.title}")
                // The embed is the whole reason this select is shaped the
                // way it is; a null here means it silently did not join.
                assertTrue("embedded game missing on log ${it.id}", it.games != null)
            }
            if (checked > 0) break
        }
        println("logs parsed: $checked")
    }

    /**
     * The ratings histogram. Ten buckets, always — a game nobody has
     * rated still gets an empty chart rather than no chart, which is the
     * behaviour the web app was explicitly asked for.
     */
    @Test
    fun `rating distribution always has ten buckets`() = runBlocking {
        val games = repo.searchGames("the")
        if (games.isEmpty()) return@runBlocking
        val buckets = repo.ratingDistribution(games.first().id)
        assertEquals("a histogram is ten half-star buckets", 10, buckets.size)
        assertTrue("counts cannot be negative", buckets.all { it >= 0 })
        println("distribution for ${games.first().title}: $buckets")
    }

    /**
     * The four-source activity merge, run for a signed-out viewer. The
     * point is not that it returns rows — RLS correctly hides everything
     * from anon — but that all four queries are ACCEPTED. A malformed
     * embed would throw rather than return empty.
     */
    @Test
    fun `activity merge issues four valid queries`() = runBlocking {
        val anonId = "00000000-0000-0000-0000-000000000000"
        val rows = repo.activity(anonId, ActivityScope.FRIENDS, includeIncoming = true)
        // Signed out, this must be empty AND must not have thrown.
        assertTrue("anon should see no activity, saw ${rows.size}", rows.isEmpty())
        println("activity merge ran clean for an anonymous viewer")
    }

    @Test
    fun `following set query parses`() = runBlocking {
        val ids = repo.followingIds("00000000-0000-0000-0000-000000000000")
        assertTrue("anon follows nobody", ids.isEmpty())
    }

    // ---- pure logic, no network ----

    @Test
    fun `timeAgo reads the way the web app does`() {
        val now = Instant.now()
        assertEquals("just now", timeAgo(now.minusSeconds(5).toString()))
        assertEquals("5m", timeAgo(now.minusSeconds(5 * 60).toString()))
        assertEquals("3h", timeAgo(now.minusSeconds(3 * 3600).toString()))
        assertEquals("2d", timeAgo(now.minusSeconds(2 * 86_400).toString()))
        // A blank or unparseable timestamp must render as nothing rather
        // than as "just now", which would be a confident lie.
        assertEquals("", timeAgo(null))
        assertEquals("", timeAgo(""))
        assertEquals("", timeAgo("not a date"))
    }

    @Test
    fun `profile name falls back through the options`() {
        val full = com.playthruu.android.data.Profile(id = "1", username = "ishant", displayName = "Ishant Singh")
        assertEquals("Ishant Singh", full.name)
        assertEquals("IS", full.initials)

        val handleOnly = com.playthruu.android.data.Profile(id = "2", username = "playishant")
        assertEquals("playishant", handleOnly.name)
        assertEquals("@playishant", handleOnly.handle)

        val nameless = com.playthruu.android.data.Profile(id = "3")
        assertEquals("Someone", nameless.name)
        // No handle at all should print nothing, not a bare "@".
        assertEquals("", nameless.handle)
    }

    @Test
    fun `game meta joins only what exists`() {
        val both = com.playthruu.android.data.Game(id = "1", title = "Hades II", releaseYear = 2025, genre = "Indie, Hack and Slash")
        assertEquals("2025 · Indie", both.meta)

        val yearOnly = com.playthruu.android.data.Game(id = "2", title = "X", releaseYear = 2024)
        assertEquals("2024", yearOnly.meta)

        val neither = com.playthruu.android.data.Game(id = "3", title = "X")
        assertEquals("", neither.meta)
    }
}
