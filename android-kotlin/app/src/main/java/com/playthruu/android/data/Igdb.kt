package com.playthruu.android.data

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.text.Normalizer
import java.time.Instant
import java.time.ZoneOffset

/**
 * IGDB, through the same edge function the web app uses (igdb-proxy). This is
 * the Kotlin twin of the IGDB half of js/api.js: the same field lists, the
 * same where-clauses, the same ranking, so a list on the phone is the list on
 * the site.
 */
data class IgdbGame(
    val igdbId: Int,
    val title: String,
    val coverUrl: String?,       // the big cover, ready to show
    val coverFull: String?,      // the 1080p copy the database stores
    val releaseYear: Int?,
    val releaseDate: String?,
    val platform: String,
    val genre: String,
    val developer: String,
    val publisher: String,
    val rating: Double?,
    val ratingCount: Int,
    // Set when this game is already in the shared catalogue.
    val localId: String? = null,
)

/** Everything Browse can ask for. Defaults are "no filter". */
data class BrowseFilters(
    val query: String = "",
    val sort: String = "popular",
    val genre: String = "",
    val platform: String = "",
    val year: String = "",
    val players: String = "",
    val stars: String = "",
    val minVotes: Int = 0,
    val maxVotes: Int = 0,
    val minHypes: Int = 0,
    val minRating: Int = 0,
    val idList: List<Int>? = null,
    val pageSize: Int = 20,
)

object Igdb {
    private const val FN = "https://kpgjuuplpgilupogpezc.supabase.co/functions/v1/igdb-proxy"
    private const val ANON =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
            "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwZ2p1dXBscGdpbHVwb2dwZXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMDgwOTAsImV4cCI6MjEwMTU4NDA5MH0." +
            "39cjFgmgBquORUSY00vWOeuAhI3nPYIOAhQhREq9OF8"

    private val json = Json { ignoreUnknownKeys = true }
    private val http by lazy {
        HttpClient(OkHttp) {
            install(HttpTimeout) { requestTimeoutMillis = 12_000; connectTimeoutMillis = 8_000 }
        }
    }

    /** One IGDB query. A cold edge function can be slow, so one retry with more room. */
    suspend fun query(endpoint: String, query: String, retry: Boolean = true): JsonArray {
        return try {
            val body = buildJsonObject { put("endpoint", endpoint); put("query", query) }.toString()
            val res = http.post(FN) {
                header("Authorization", "Bearer $ANON")
                contentType(ContentType.Application.Json)
                setBody(body)
            }
            val el = json.parseToJsonElement(res.bodyAsText())
            if (el is JsonArray) el else JsonArray(emptyList())
        } catch (e: Exception) {
            if (retry) query(endpoint, query, retry = false) else JsonArray(emptyList())
        }
    }

    // ---- images -------------------------------------------------------
    fun image(imageId: String?, size: String = "cover_big"): String? =
        imageId?.let { "https://images.igdb.com/igdb/image/upload/t_$size/$it.jpg" }

    /** Rewrites an IGDB url to another size, like igdbSized() in utils.js. */
    fun sized(url: String?, size: String): String? {
        if (url.isNullOrBlank() || !url.contains("images.igdb.com")) return url
        return url.replace(Regex("/t_[a-z0-9_]+/", RegexOption.IGNORE_CASE), "/t_$size/")
    }

    // ---- mapping --------------------------------------------------------
    private const val LIST_FIELDS =
        "name,category,cover.image_id,first_release_date,platforms.name,genres.name," +
            "involved_companies.company.name,involved_companies.developer,involved_companies.publisher," +
            "total_rating,total_rating_count"

    private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
    private fun JsonObject.str(k: String) = this[k]?.jsonPrimitive?.contentOrNull
    private fun JsonObject.int(k: String) = this[k]?.jsonPrimitive?.intOrNull
    private fun JsonObject.dbl(k: String) = this[k]?.jsonPrimitive?.doubleOrNull
    private fun JsonObject.arr(k: String): List<JsonObject> =
        (this[k] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()

    private fun platformName(n: String) = when (n) {
        "PC (Microsoft Windows)", "Microsoft Windows" -> "PC"
        else -> n
    }

    fun map(g: JsonObject): IgdbGame? {
        val id = g.int("id") ?: return null
        val name = g.str("name") ?: return null
        val companies = g.arr("involved_companies")
        val devs = companies.filter { it["developer"]?.jsonPrimitive?.contentOrNull == "true" }
            .mapNotNull { it["company"].obj()?.str("name") }
        val pubs = companies.filter { it["publisher"]?.jsonPrimitive?.contentOrNull == "true" }
            .mapNotNull { it["company"].obj()?.str("name") }
        val ts = g["first_release_date"]?.jsonPrimitive?.longOrNull
        val date = ts?.let { Instant.ofEpochSecond(it).atZone(ZoneOffset.UTC).toLocalDate() }
        val imageId = g["cover"].obj()?.str("image_id")
        return IgdbGame(
            igdbId = id,
            title = name,
            coverUrl = image(imageId, "cover_big"),
            coverFull = image(imageId, "1080p"),
            releaseYear = date?.year,
            releaseDate = date?.toString(),
            platform = g.arr("platforms").mapNotNull { it.str("name") }.take(3).joinToString(", ") { platformName(it) },
            genre = g.arr("genres").mapNotNull { it.str("name") }.take(2).joinToString(", "),
            developer = devs.take(2).joinToString(", "),
            publisher = pubs.take(2).joinToString(", "),
            rating = g.dbl("total_rating"),
            ratingCount = g.int("total_rating_count") ?: 0,
        )
    }

    // ---- title helpers (twins of normalizeTitle / looseTitle / dedupeKey) --
    private val ROMAN = listOf("", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi")

    fun normalizeTitle(s: String?): String =
        Normalizer.normalize((s ?: "").lowercase(), Normalizer.Form.NFKD)
            .replace(Regex("[\\u0300-\\u036f]"), "")
            .replace(Regex("[\\u2019\\u2018'`\\u00b4]"), "")
            .replace(Regex("[^a-z0-9]+"), " ").trim().replace(Regex("\\s+"), " ")

    private fun looseTitle(s: String?): String =
        (s ?: "").lowercase().replace(Regex("[’‘'`´]"), "")
            .replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim().replace(Regex("\\s+"), " ")

    fun dedupeKey(title: String?): String {
        val t = normalizeTitle((title ?: "").replace(Regex("\\s*\\(\\s*(19|20)\\d{2}\\s*\\)\\s*$"), ""))
        if (t.isEmpty()) return ""
        return t.split(" ").joinToString(" ") { w ->
            if (w.length < 2) w else ROMAN.indexOf(w).let { i -> if (i > 0) i.toString() else w }
        }
    }

    private val TITLE_ALIASES = mapOf(
        "gta" to listOf("grand theft auto"), "rdr" to listOf("red dead redemption"),
        "tlou" to listOf("the last of us"), "gow" to listOf("god of war"),
        "ac" to listOf("assassin's creed"), "botw" to listOf("the legend of zelda breath of the wild", "breath of the wild"),
        "totk" to listOf("the legend of zelda tears of the kingdom", "tears of the kingdom"),
        "ds" to listOf("dark souls", "death stranding"), "re" to listOf("resident evil"),
        "mgs" to listOf("metal gear solid"), "ff" to listOf("final fantasy"), "nfs" to listOf("need for speed"),
        "cs" to listOf("counter-strike"), "dmc" to listOf("devil may cry"), "kh" to listOf("kingdom hearts"),
        "bg3" to listOf("baldur's gate 3"), "cp" to listOf("cyberpunk"), "cp2077" to listOf("cyberpunk 2077"),
        "tw3" to listOf("the witcher 3 wild hunt"), "tw" to listOf("the witcher"), "pubg" to listOf("playerunknown's battlegrounds"),
        "mh" to listOf("monster hunter"), "er" to listOf("elden ring"), "mk" to listOf("mortal kombat"),
        "sf" to listOf("street fighter"), "hl" to listOf("half-life"), "p5" to listOf("persona 5"),
        "lol" to listOf("league of legends"), "wow" to listOf("world of warcraft"), "gtav" to listOf("grand theft auto v"),
        "oot" to listOf("the legend of zelda ocarina of time"), "ssbu" to listOf("super smash bros ultimate"),
        "tes" to listOf("the elder scrolls"), "dbd" to listOf("dead by daylight"), "poe" to listOf("path of exile"),
    )

    /** Every spelling of a query worth trying, most literal first (the useful part of expandQuery). */
    fun expandQuery(query: String): List<String> {
        val raw = query.trim()
        if (raw.isEmpty()) return emptyList()
        val out = mutableListOf(raw)
        val norm = normalizeTitle(raw)
        if (norm.isEmpty()) return out
        val words = norm.split(" ")
        val head = words.first()
        val rest = words.drop(1).joinToString(" ")
        TITLE_ALIASES[norm]?.let { out += it }
        if (rest.isNotEmpty()) TITLE_ALIASES[head]?.forEach { out += "$it $rest" }
        Regex("^([a-z]+)(\\d{1,2})$").find(head)?.let { m ->
            val tail = listOf(m.groupValues[2], rest).filter { it.isNotEmpty() }.joinToString(" ")
            TITLE_ALIASES[m.groupValues[1]]?.forEach { out += "$it $tail" }
        }
        val seen = HashSet<String>()
        return out.filter { val k = normalizeTitle(it); k.isNotEmpty() && seen.add(k) }
    }

    private const val TIER_WORST = 7

    private fun tierExact(query: String, title: String): Int {
        val qe = looseTitle(query); val te = looseTitle(title)
        if (qe.isNotEmpty() && te == qe) return 0
        val q = normalizeTitle(query); val t = normalizeTitle(title)
        if (q.isEmpty() || t.isEmpty()) return TIER_WORST
        if (t == q) return 1
        val tw = t.split(" ")
        if (tw.first() == q) return 2
        if (t.startsWith("$q ")) return 3
        if (tw.contains(q)) return 4
        if (t.startsWith(q)) return 5
        if (t.contains(q)) return 6
        val qw = q.split(" "); val set = tw.toSet()
        if (qw.all { it in set }) return 6
        return TIER_WORST
    }

    fun tier(query: String, title: String): Int {
        val direct = tierExact(query, title)
        if (direct <= 1) return direct
        var best = direct
        val forms = expandQuery(query)
        for (i in 1 until forms.size) {
            val t = tierExact(forms[i], title)
            if (t >= TIER_WORST) continue
            best = minOf(best, minOf(t + 1, TIER_WORST - 1))
        }
        return best
    }

    private val EDITION_PHRASES = listOf(
        "deluxe edition", "deluxe upgrade", "digital deluxe", "gold edition", "ultimate edition",
        "complete edition", "definitive edition", "collector's edition", "collectors edition", "goty edition",
        "game of the year edition", "premium edition", "standard edition", "anniversary edition",
        "legendary edition", "enhanced edition", "season pass",
    )

    fun looksLikeEdition(title: String): Boolean {
        val t = normalizeTitle(title)
        if (t.isEmpty()) return false
        if (Regex("\\bbundle\\b").containsMatchIn(t)) return true
        if (t.contains("fx mod")) return true
        if (EDITION_PHRASES.any { t.contains(normalizeTitle(it)) }) return true
        return Regex("\\bdeluxe$").containsMatchIn(t) || Regex("\\bupgrade$").containsMatchIn(t)
    }

    fun rank(query: String, games: List<IgdbGame>): List<IgdbGame> =
        games.sortedWith(compareBy<IgdbGame> { tier(query, it.title) }.thenByDescending { it.ratingCount })

    // ---- search -----------------------------------------------------------
    private fun esc(s: String) = s.replace("\\", "\\\\").replace("\"", "\\\"")

    suspend fun search(query: String, limit: Int = 20, page: Int = 1): List<IgdbGame> {
        if (query.isBlank()) return emptyList()
        val fetchLimit = maxOf(limit * 3, 60)
        val offset = (page - 1) * limit
        val q = "search \"${esc(query)}\"; fields $LIST_FIELDS; where version_parent = null; limit $fetchLimit; offset $offset;"
        val rows = query("games", q)
        val games = rows.mapNotNull { (it as? JsonObject) }
            .filter { it.int("category") != 3 && it.int("category") != 13 }
            .mapNotNull { map(it) }
            .filterNot { looksLikeEdition(it.title) }
        return rank(query, games).take(limit)
    }

    // ---- browse (the twin of browseGames in api.js) -------------------------
    private val GAME_TYPE_FULL = "0,4,8,9,10"
    private val PLAYER_CLAUSES = mapOf(
        "solo" to "game_modes = (1) & game_modes != (2,3,5,6)",
        "split" to "multiplayer_modes.splitscreen = true & game_modes != (5,6)",
        "coop" to "multiplayer_modes.campaigncoop = true & game_modes != (5,6)",
    )

    private var trendingCache: Pair<Long, List<Int>>? = null
    private suspend fun trendingIds(): List<Int> {
        trendingCache?.let { if (System.currentTimeMillis() - it.first < 600_000) return it.second }
        val pop = query("popularity_primitives", "fields game_id,value; where popularity_type = 1; sort value desc; limit 500;")
        val ids = pop.mapNotNull { (it as? JsonObject)?.int("game_id") }.distinct()
        if (ids.isNotEmpty()) trendingCache = System.currentTimeMillis() to ids
        return ids
    }

    private fun yearRange(year: String): Pair<String, String>? {
        val thisYear = java.time.LocalDate.now().year
        return when (year) {
            "this" -> "$thisYear-01-01" to "$thisYear-12-31"
            "last" -> "${thisYear - 1}-01-01" to "${thisYear - 1}-12-31"
            "2020s" -> "2020-01-01" to "2029-12-31"
            "2010s" -> "2010-01-01" to "2019-12-31"
            "2000s" -> "2000-01-01" to "2009-12-31"
            "1990s" -> "1990-01-01" to "1999-12-31"
            "1980s" -> "1980-01-01" to "1989-12-31"
            "older" -> "1950-01-01" to "1979-12-31"
            else -> null
        }
    }

    private fun epoch(date: String, endOfDay: Boolean): Long =
        java.time.LocalDate.parse(date).atTime(if (endOfDay) java.time.LocalTime.of(23, 59, 59) else java.time.LocalTime.MIDNIGHT)
            .toEpochSecond(ZoneOffset.UTC)

    /** One page of games. Returns the games and whether another page may exist. */
    suspend fun browse(f: BrowseFilters, page: Int = 1): Pair<List<IgdbGame>, Boolean> {
        val limit = f.pageSize
        val offset = (page - 1) * limit
        val now = System.currentTimeMillis() / 1000
        val clauses = mutableListOf("version_parent = null")
        val text = f.query.trim().replace(Regex("[\"\\\\]"), " ").replace(Regex("\\s+"), " ")
        if (text.isNotEmpty()) clauses += "name ~ *\"$text\"*"
        f.idList?.let { if (it.isEmpty()) return emptyList<IgdbGame>() to false; clauses += "id = (${it.joinToString(",")})" }
        if (f.sort != "anticipated") clauses += "(first_release_date <= $now | first_release_date = null)"

        if (f.genre.isNotEmpty()) {
            val (kind, id) = f.genre.split(":").let { it[0] to it.getOrElse(1) { "" } }
            clauses += if (kind == "theme") "themes = ($id)" else "genres = ($id)"
        }
        if (f.platform.isNotEmpty()) clauses += "platforms = (${f.platform})"
        PLAYER_CLAUSES[f.players]?.let { clauses += it }
        var minVotes = f.minVotes
        val stars = f.stars.toDoubleOrNull() ?: 0.0
        if (stars in 0.5..5.0) {
            val lo = stars * 20 - 5; val hi = minOf(100.0, stars * 20 + 5)
            clauses += "total_rating >= $lo & total_rating ${if (stars >= 5) "<=" else "<"} $hi"
            if (minVotes == 0) minVotes = 60
        }
        if (minVotes == 0 && (f.sort == "top_rated" || f.sort == "all_time" || f.sort == "lowest")) minVotes = 300
        else if (minVotes == 0 && (f.sort == "az" || f.sort == "oldest")) minVotes = 20
        if (f.sort == "newest" && minVotes == 0) clauses += "(total_rating_count >= 10 | hypes >= 25)"
        else if (minVotes == 0 && f.minRating > 0) minVotes = if (f.sort == "recent") 10 else 60
        clauses += "game_type = ($GAME_TYPE_FULL)"
        if (f.minHypes > 0) clauses += "hypes >= ${f.minHypes}"
        if (f.sort == "oldest") clauses += "first_release_date != null"
        val range = yearRange(f.year)
        val fromSec = range?.let { epoch(it.first, false) }
        val toSec = range?.let { epoch(it.second, true) }
        if (f.sort == "recent" && range == null) clauses += "first_release_date >= ${now - 120 * 86400}"
        if (f.sort == "all_time") clauses += "aggregated_rating != null & aggregated_rating_count >= 3"
        if (f.minRating > 0) clauses += "total_rating >= ${f.minRating}"
        if (minVotes > 0) clauses += "total_rating_count >= $minVotes"
        if (f.maxVotes > 0) clauses += "total_rating_count <= ${f.maxVotes}"
        if (f.sort == "anticipated") {
            clauses += "first_release_date >= ${maxOf(now, fromSec ?: 0)} & first_release_date <= ${toSec ?: (now + 9 * 30 * 86400)}"
        } else if (fromSec != null || toSec != null) {
            clauses += "first_release_date >= ${fromSec ?: 0} & first_release_date <= ${toSec ?: now}"
        }

        if (f.sort == "trending") {
            val ranked = trendingIds()
            if (ranked.isEmpty()) return emptyList<IgdbGame>() to false
            clauses += "id = (${ranked.joinToString(",")})"
            val pool = query("games", "fields $LIST_FIELDS; where ${clauses.joinToString(" & ")}; limit 500;")
            val rank = ranked.withIndex().associate { it.value to it.index }
            val sorted = pool.mapNotNull { it as? JsonObject }.sortedBy { rank[it.int("id")] ?: Int.MAX_VALUE }
            val slice = sorted.drop(offset).take(limit).mapNotNull { map(it) }.filterNot { looksLikeEdition(it.title) }
            return slice to (sorted.size > offset + limit)
        }

        var sortClause = "total_rating_count desc"
        when (f.sort) {
            "top_rated" -> sortClause = "total_rating desc"
            "lowest" -> { sortClause = "total_rating asc"; clauses += "total_rating != null" }
            "all_time" -> sortClause = "aggregated_rating desc"
            "anticipated" -> sortClause = "hypes desc"
            "newest" -> sortClause = "first_release_date desc"
            "oldest" -> sortClause = "first_release_date asc"
            "recent" -> sortClause = "hypes desc"
            "az" -> sortClause = "name asc"
        }
        val q = "fields $LIST_FIELDS; where ${clauses.joinToString(" & ")}; sort $sortClause; limit $limit; offset $offset;"
        val rows = query("games", q)
        val games = rows.mapNotNull { it as? JsonObject }.mapNotNull { map(it) }.filterNot { looksLikeEdition(it.title) }
        return games to (rows.size == limit)
    }

    /** What people are looking at right now, for the Home row (first [limit]). */
    suspend fun trending(limit: Int = 12): List<IgdbGame> {
        val (games, _) = browse(BrowseFilters(sort = "trending", pageSize = limit), 1)
        return games.take(limit)
    }
}
