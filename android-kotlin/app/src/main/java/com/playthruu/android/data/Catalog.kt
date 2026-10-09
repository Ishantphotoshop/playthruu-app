package com.playthruu.android.data

import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A story from the News tab (news_articles). */
@Serializable
data class NewsRow(
    val slug: String,
    val title: String,
    @SerialName("image_url") val imageUrl: String? = null,
    val importance: String? = null,
    @SerialName("updated_at") val updatedAt: String,
    @SerialName("pinned_at") val pinnedAt: String? = null,
    @SerialName("verification_status") val verification: String? = null,
)

/** The game as a card, however it was found. */
fun Game.toCard(): IgdbGame = IgdbGame(
    igdbId = igdbId ?: 0,
    title = title,
    coverUrl = Igdb.sized(coverUrl, "cover_big"),
    coverFull = coverUrl,
    releaseYear = releaseYear,
    releaseDate = null,
    platform = platform ?: "",
    genre = genre ?: "",
    developer = "",
    publisher = "",
    rating = null,
    ratingCount = 0,
    localId = id,
)

/**
 * The shared game catalogue (the `games` table) and the bits of home
 * and news the web app reads next to it. Twins of addGame, searchGames,
 * getFriendsPlaying and getGameNews in js/api.js.
 */
object Catalog {
    private const val GAME_COLS =
        "id, title, cover_url, background_url, genre, platform, release_year, studio_name, description, igdb_id"
    private const val LOG_COLS =
        "id, user_id, game_id, rating, review, status, played_date, is_replay, contains_spoilers, is_public, " +
            "hours_played, created_at, updated_at, " +
            "games!logs_game_id_fkey($GAME_COLS), " +
            "profiles!logs_user_id_fkey(id, username, display_name, avatar_url)"

    private val client get() = Supa.client

    private val known = HashMap<Int, Game>()

    /** The catalogue row for an IGDB game, created the first time anyone opens it. */
    suspend fun addGame(g: IgdbGame, userId: String): Game {
        g.localId?.let { id -> return Repository().game(id) ?: error("That game is gone.") }
        known[g.igdbId]?.let { return it }
        val existing = client.from("games").select(Columns.raw(GAME_COLS)) {
            filter { eq("igdb_id", g.igdbId) }
            limit(1)
        }.decodeList<Game>().firstOrNull()
        if (existing != null) { known[g.igdbId] = existing; return existing }
        val row = buildJsonObject {
            put("title", g.title)
            put("cover_url", g.coverFull)
            put("platform", g.platform.ifBlank { null })
            put("release_year", g.releaseYear)
            put("release_date", g.releaseDate)
            put("genre", g.genre.ifBlank { null })
            put("developer", g.developer.ifBlank { null })
            put("publisher", g.publisher.ifBlank { null })
            put("igdb_id", g.igdbId)
            put("added_by", userId)
        }
        val saved = client.from("games").insert(row) { select(Columns.raw(GAME_COLS)) }.decodeSingle<Game>()
        known[g.igdbId] = saved
        return saved
    }

    /** Games already in the catalogue whose title contains [query]. */
    suspend fun localGames(query: String, limit: Long = 20): List<IgdbGame> {
        val q = query.trim()
        if (q.isEmpty()) return emptyList()
        return client.from("games").select(Columns.raw(GAME_COLS)) {
            filter {
                ilike("title", "%$q%")
                // rows predating is_hidden have it NULL, so "not true", never "eq false"
                filterNot("is_hidden", io.github.jan.supabase.postgrest.query.filter.FilterOperator.IS, true)
            }
            order("title", Order.ASCENDING)
            limit(limit)
        }.decodeList<Game>().map { it.toCard() }
    }

    /**
     * What the people you follow logged with this status, newest first. With
     * nobody followed it falls back to everyone's public logs for "playing"
     * (the second value says so), and to nothing for "played".
     */
    suspend fun friendsLogs(userId: String, status: String, limit: Long = 15): Pair<List<GameLog>, Boolean> {
        val ids = Repository().followingIds(userId)
        if (ids.isEmpty()) {
            if (status != "playing") return emptyList<GameLog>() to false
            val rows = client.from("logs").select(Columns.raw(LOG_COLS)) {
                filter { eq("status", status); eq("is_public", true) }
                order("created_at", Order.DESCENDING)
                limit(limit)
            }.decodeList<GameLog>()
            return rows to true
        }
        val rows = client.from("logs").select(Columns.raw(LOG_COLS)) {
            filter {
                isIn("user_id", ids.toList())
                eq("status", status)
                eq("is_public", true)
            }
            order("created_at", Order.DESCENDING)
            limit(limit)
        }.decodeList<GameLog>()
        return rows to false
    }

    /** Published stories, pinned first, then fresh breaking ones, then the rest. */
    suspend fun news(limit: Long = 300): List<NewsRow> {
        val rows = client.from("news_articles").select(
            Columns.raw("slug, title, image_url, importance, updated_at, pinned_at, verification_status")
        ) {
            filter { eq("status", "published") }
            order("updated_at", Order.DESCENDING)
            limit(limit)
        }.decodeList<NewsRow>()
        val now = System.currentTimeMillis()
        fun ageH(r: NewsRow) = runCatching { (now - java.time.Instant.parse(r.updatedAt).toEpochMilli()) / 3_600_000.0 }.getOrDefault(1e9)
        val pinned = rows.filter { it.pinnedAt != null }.sortedByDescending { it.pinnedAt }
        val rest = rows.filter { it.pinnedAt == null }
        val windowH = mapOf("breaking" to 72.0, "important" to 48.0)
        val (top, latest) = rest.partition { r -> windowH[r.importance]?.let { ageH(r) <= it } == true }
        fun weight(r: NewsRow) = if (r.importance == "breaking") 3 else if (r.verification == "confirmed") 2 else 1
        val topSorted = top.sortedWith(compareByDescending<NewsRow> { weight(it) }.thenByDescending { it.updatedAt })
        return pinned + topSorted + latest
    }

    /** First page of the unread-news dot: the newest publish time. */
    suspend fun latestNewsTime(): String? = runCatching {
        client.from("news_articles").select(Columns.raw("slug, title, updated_at")) {
            filter { eq("status", "published") }
            order("updated_at", Order.DESCENDING)
            limit(1)
        }.decodeList<NewsRow>().firstOrNull()?.updatedAt
    }.getOrNull()
}
