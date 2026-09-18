package com.playthruu.android.data

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.storage.Storage
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Every query the app makes, in one place.
 *
 * The web app's js/api.js is the reference for what these mean; this is
 * not a new API surface, it is the same one expressed in Kotlin. Where a
 * query looks odd, the reason is almost always a Row Level Security
 * policy on the other end, and the web version carries the same shape
 * for the same reason.
 */
object Supa {
    // Safe to ship, exactly as it is in js/config.js — the data is
    // protected by RLS, not by hiding this.
    private const val URL = "https://kpgjuuplpgilupogpezc.supabase.co"
    private const val ANON =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
            "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwZ2p1dXBscGdpbHVwb2dwZXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMDgwOTAsImV4cCI6MjEwMTU4NDA5MH0." +
            "39cjFgmgBquORUSY00vWOeuAhI3nPYIOAhQhREq9OF8"

    val client: SupabaseClient by lazy {
        createSupabaseClient(supabaseUrl = URL, supabaseKey = ANON) {
            install(Auth)
            install(Postgrest)
            install(Realtime)
            install(Storage)
            // The database has columns this app does not model yet, and
            // more will be added by the web side without this one being
            // rebuilt. Ignoring unknown keys is what keeps that from
            // being a crash.
            defaultSerializer = io.github.jan.supabase.serializer.KotlinXSerializer(
                Json { ignoreUnknownKeys = true; explicitNulls = false }
            )
        }
    }
}

/** Column lists, kept beside each other so the embeds stay consistent. */
private object Cols {
    const val PROFILE = "id, username, display_name, avatar_url, bio, pronouns, pronouns_custom, comment_permission"
    const val PROFILE_LITE = "id, username, display_name, avatar_url"
    const val GAME = "id, title, cover_url, background_url, genre, platform, release_year, studio_name, description, igdb_id"
    const val GAME_LITE = "id, title, cover_url, genre, release_year"

    // The FK constraint names are explicit because logs joins profiles
    // more than one way across the schema, and PostgREST will not guess.
    val LOG_FULL = """
        id, user_id, game_id, rating, review, status, played_date, is_replay,
        contains_spoilers, is_public, hours_played, created_at, updated_at,
        games!logs_game_id_fkey($GAME),
        profiles!logs_user_id_fkey($PROFILE_LITE)
    """.trimIndent()
}

class Repository(private val client: SupabaseClient = Supa.client) {

    // ---- auth ----------------------------------------------------------

    suspend fun signIn(email: String, password: String) {
        client.auth.signInWith(Email) {
            this.email = email.trim()
            this.password = password
        }
    }

    suspend fun signUp(email: String, password: String) {
        client.auth.signUpWith(Email) {
            this.email = email.trim()
            this.password = password
        }
    }

    suspend fun signOut() = client.auth.signOut()

    fun currentUserId(): String? = client.auth.currentSessionOrNull()?.user?.id

    // ---- profiles ------------------------------------------------------

    suspend fun profile(userId: String): Profile? =
        client.from("profiles").select(Columns.raw(Cols.PROFILE)) {
            filter { eq("id", userId) }
            limit(1)
        }.decodeSingleOrNull()

    suspend fun profileByUsername(username: String): Profile? =
        client.from("profiles").select(Columns.raw(Cols.PROFILE)) {
            filter { eq("username", username) }
            limit(1)
        }.decodeSingleOrNull()

    suspend fun followingIds(userId: String): Set<String> =
        client.from("follows").select(Columns.list("following_id")) {
            filter { eq("follower_id", userId) }
        }.decodeList<FollowingId>().map { it.followingId }.toSet()

    suspend fun isFollowing(me: String, them: String): Boolean =
        client.from("follows").select(Columns.list("following_id")) {
            filter { eq("follower_id", me); eq("following_id", them) }
            limit(1)
        }.decodeList<FollowingId>().isNotEmpty()

    suspend fun follow(me: String, them: String) {
        client.from("follows").insert(Follow(me, them))
    }

    suspend fun unfollow(me: String, them: String) {
        client.from("follows").delete {
            filter { eq("follower_id", me); eq("following_id", them) }
        }
    }

    // ---- logs / feed ---------------------------------------------------

    /**
     * The home feed: recent public logs from the people you follow, or
     * the whole app when you follow nobody yet — an empty home screen is
     * a worse first impression than a slightly impersonal one.
     */
    suspend fun feed(userId: String, limit: Long = 30): Pair<List<GameLog>, Boolean> {
        val ids = followingIds(userId)
        if (ids.isEmpty()) {
            val rows = client.from("logs").select(Columns.raw(Cols.LOG_FULL)) {
                filter { eq("is_public", true) }
                order("updated_at", Order.DESCENDING)
                limit(limit)
            }.decodeList<GameLog>()
            return rows to true
        }
        val rows = client.from("logs").select(Columns.raw(Cols.LOG_FULL)) {
            filter {
                isIn("user_id", ids.toList())
                eq("is_public", true)
            }
            order("updated_at", Order.DESCENDING)
            limit(limit)
        }.decodeList<GameLog>()
        return rows to false
    }

    suspend fun logsForUser(userId: String, limit: Long = 100): List<GameLog> =
        client.from("logs").select(Columns.raw(Cols.LOG_FULL)) {
            filter { eq("user_id", userId) }
            order("created_at", Order.DESCENDING)
            limit(limit)
        }.decodeList()

    suspend fun logsForGame(gameId: String, limit: Long = 50): List<GameLog> =
        client.from("logs").select(Columns.raw(Cols.LOG_FULL)) {
            filter { eq("game_id", gameId); eq("is_public", true) }
            order("created_at", Order.DESCENDING)
            limit(limit)
        }.decodeList()

    suspend fun myLogForGame(userId: String, gameId: String): GameLog? =
        client.from("logs").select(Columns.raw(Cols.LOG_FULL)) {
            filter { eq("user_id", userId); eq("game_id", gameId) }
            order("created_at", Order.DESCENDING)
            limit(1)
        }.decodeSingleOrNull()

    suspend fun saveLog(draft: LogDraft, existingId: String?): GameLog =
        if (existingId == null) {
            client.from("logs").insert(draft) { select(Columns.raw(Cols.LOG_FULL)) }.decodeSingle()
        } else {
            client.from("logs").update(draft) {
                filter { eq("id", existingId) }
                select(Columns.raw(Cols.LOG_FULL))
            }.decodeSingle()
        }

    suspend fun deleteLog(logId: String) {
        client.from("logs").delete { filter { eq("id", logId) } }
    }

    // ---- likes ---------------------------------------------------------

    suspend fun likeCount(logId: String): Long =
        client.from("log_likes").select(Columns.list("log_id")) {
            count(io.github.jan.supabase.postgrest.query.Count.EXACT)
            filter { eq("log_id", logId) }
        }.countOrNull() ?: 0

    suspend fun hasLiked(userId: String, logId: String): Boolean =
        client.from("log_likes").select(Columns.list("log_id")) {
            filter { eq("user_id", userId); eq("log_id", logId) }
            limit(1)
        }.decodeList<LogLike>().isNotEmpty()

    suspend fun setLiked(userId: String, logId: String, liked: Boolean) {
        if (liked) client.from("log_likes").insert(LogLike(userId, logId))
        else client.from("log_likes").delete {
            filter { eq("user_id", userId); eq("log_id", logId) }
        }
    }

    // ---- games ---------------------------------------------------------

    suspend fun game(gameId: String): Game? =
        client.from("games").select(Columns.raw(Cols.GAME)) {
            filter { eq("id", gameId) }
            limit(1)
        }.decodeSingleOrNull()

    /** Local catalogue search. IGDB search lives behind an edge function
     *  the web app calls; this build searches what has been added here,
     *  which is what every already-logged game is. */
    suspend fun searchGames(query: String, limit: Long = 30): List<Game> {
        val q = query.trim()
        if (q.length < 2) return emptyList()
        return client.from("games").select(Columns.raw(Cols.GAME)) {
            filter { ilike("title", "%$q%") }
            order("release_year", Order.DESCENDING, nullsFirst = false)
            limit(limit)
        }.decodeList()
    }

    suspend fun searchProfiles(query: String, limit: Long = 30): List<Profile> {
        val q = query.trim()
        if (q.length < 2) return emptyList()
        return client.from("profiles").select(Columns.raw(Cols.PROFILE_LITE)) {
            filter {
                or {
                    ilike("username", "%$q%")
                    ilike("display_name", "%$q%")
                }
            }
            limit(limit)
        }.decodeList()
    }

    /**
     * The ten buckets of the ratings histogram, 0.5 to 5.0.
     *
     * Counted here rather than in SQL because the rating column is a
     * half-star numeric and grouping it server-side would need an RPC
     * for what is one pass over at most a few hundred rows.
     */
    suspend fun ratingDistribution(gameId: String): List<Int> {
        val rows = client.from("logs").select(Columns.list("rating")) {
            filter { eq("game_id", gameId); eq("is_public", true) }
        }.decodeList<RatingOnly>()
        val buckets = IntArray(10)
        rows.mapNotNull { it.rating }.forEach { r ->
            val index = (r * 2).toInt() - 1
            if (index in 0..9) buckets[index]++
        }
        return buckets.toList()
    }

    @kotlinx.serialization.Serializable
    private data class RatingOnly(val rating: Double? = null)

    // ---- activity ------------------------------------------------------

    /**
     * The activity stream, merged from four tables the same way the web
     * app does it — and for the same reason. Each of logs, log_likes,
     * follows and comments already carries its own RLS policy; a single
     * view would have to restate all four correctly to stay as safe, so
     * the database keeps one answer for who may read what and the merge
     * is only presentation.
     *
     * The four queries go out together rather than in sequence: they do
     * not depend on each other, and four round trips in a row is the
     * difference between a screen that appears and one that arrives.
     */
    suspend fun activity(
        userId: String,
        scope: ActivityScope,
        includeYou: Boolean = false,
        includeIncoming: Boolean = false,
        limit: Long = 40,
    ): List<ActivityItem> = coroutineScope {
        val actorIds: List<String> = when (scope) {
            ActivityScope.YOU -> listOf(userId)
            ActivityScope.FRIENDS -> followingIds(userId).toMutableList().also {
                if (includeYou) it.add(userId)
            }
            ActivityScope.INCOMING -> emptyList()
        }
        val wantIncoming = scope == ActivityScope.INCOMING ||
            (scope == ActivityScope.FRIENDS && includeIncoming)

        // Explicitly typed: without the annotation Kotlin tries to infer
        // the branch type from `null` and gives up.
        // runCatching per source on purpose — one failing query should
        // thin the stream, never empty it.
        // (a local typealias is not a thing in Kotlin, hence the long form)
        val logsJob: Deferred<List<ActivityItem>>? = if (actorIds.isEmpty()) null else async { runCatching { activityLogs(actorIds, limit) }.getOrDefault(emptyList()) }
        val likesJob: Deferred<List<ActivityItem>>? = if (actorIds.isEmpty()) null else async { runCatching { activityLikes(actorIds, limit) }.getOrDefault(emptyList()) }
        val followsJob: Deferred<List<ActivityItem>>? = if (actorIds.isEmpty()) null else async { runCatching { activityFollows(actorIds, userId, limit) }.getOrDefault(emptyList()) }
        val incomingJob: Deferred<List<ActivityItem>>? = if (!wantIncoming) null else async { runCatching { activityIncoming(userId, limit) }.getOrDefault(emptyList()) }

        val all = listOfNotNull(logsJob, likesJob, followsJob, incomingJob)
            .flatMap { it.await() }

        // The same event can arrive twice — somebody you follow liking
        // your review is both friend activity and incoming — so rows are
        // keyed by the EVENT, and the incoming copy wins because it is
        // the one carrying unread state.
        val byKey = LinkedHashMap<String, ActivityItem>()
        for (row in all) {
            val prior = byKey[row.key]
            if (prior == null || (row.unread && !prior.unread)) byKey[row.key] = row
        }
        byKey.values.sortedByDescending { it.createdAt }.take(limit.toInt())
    }

    private suspend fun activityLogs(actorIds: List<String>, limit: Long): List<ActivityItem> =
        client.from("logs").select(Columns.raw(Cols.LOG_FULL)) {
            filter { isIn("user_id", actorIds); eq("is_public", true) }
            order("created_at", Order.DESCENDING)
            limit(limit)
        }.decodeList<GameLog>().mapNotNull { log ->
            val game = log.games ?: return@mapNotNull null
            ActivityItem.Logged(
                key = "log:${log.id}",
                createdAt = log.createdAt ?: "",
                actor = log.profiles,
                log = log,
                game = game,
            )
        }

    @kotlinx.serialization.Serializable
    private data class LikeRow(
        @kotlinx.serialization.SerialName("user_id") val userId: String,
        @kotlinx.serialization.SerialName("log_id") val logId: String,
        @kotlinx.serialization.SerialName("created_at") val createdAt: String,
        val actor: Profile? = null,
        val log: LikedLog? = null,
    )

    @kotlinx.serialization.Serializable
    private data class LikedLog(
        val id: String,
        @kotlinx.serialization.SerialName("user_id") val userId: String? = null,
        @kotlinx.serialization.SerialName("is_public") val isPublic: Boolean = true,
        val games: Game? = null,
        val owner: Profile? = null,
    )

    private suspend fun activityLikes(actorIds: List<String>, limit: Long): List<ActivityItem> {
        val cols = """
            user_id, log_id, created_at,
            actor:profiles!log_likes_user_id_fkey(${Cols.PROFILE_LITE}),
            log:logs!log_likes_log_id_fkey(
              id, user_id, is_public,
              games!logs_game_id_fkey(${Cols.GAME_LITE}),
              owner:profiles!logs_user_id_fkey(${Cols.PROFILE_LITE})
            )
        """.trimIndent()
        return client.from("log_likes").select(Columns.raw(cols)) {
            filter { isIn("user_id", actorIds) }
            order("created_at", Order.DESCENDING)
            limit(limit)
        }.decodeList<LikeRow>()
            // A like on a log since made private stays hidden: the embed
            // still returns the row, so the check has to happen here.
            .filter { it.log?.isPublic == true }
            .map {
                ActivityItem.Liked(
                    key = "like:${it.userId}:${it.logId}",
                    createdAt = it.createdAt,
                    actor = it.actor,
                    game = it.log?.games,
                    logId = it.logId,
                    owner = it.log?.owner,
                    targetIsViewer = false,
                )
            }
    }

    @kotlinx.serialization.Serializable
    private data class FollowRow(
        @kotlinx.serialization.SerialName("follower_id") val followerId: String,
        @kotlinx.serialization.SerialName("following_id") val followingId: String,
        @kotlinx.serialization.SerialName("created_at") val createdAt: String,
        val actor: Profile? = null,
        val target: Profile? = null,
    )

    private suspend fun activityFollows(actorIds: List<String>, viewerId: String, limit: Long): List<ActivityItem> {
        val cols = """
            follower_id, following_id, created_at,
            actor:profiles!follows_follower_id_fkey(${Cols.PROFILE_LITE}),
            target:profiles!follows_following_id_fkey(${Cols.PROFILE_LITE})
        """.trimIndent()
        return client.from("follows").select(Columns.raw(cols)) {
            filter { isIn("follower_id", actorIds) }
            order("created_at", Order.DESCENDING)
            limit(limit)
        }.decodeList<FollowRow>().map {
            ActivityItem.Followed(
                key = "follow:${it.followerId}:${it.followingId}",
                createdAt = it.createdAt,
                actor = it.actor,
                target = it.target,
                targetIsViewer = it.followingId == viewerId,
            )
        }
    }

    @kotlinx.serialization.Serializable
    private data class IncomingRow(
        val id: String,
        val kind: String,
        @kotlinx.serialization.SerialName("actor_id") val actorId: String? = null,
        @kotlinx.serialization.SerialName("log_id") val logId: String? = null,
        @kotlinx.serialization.SerialName("comment_id") val commentId: String? = null,
        @kotlinx.serialization.SerialName("read_at") val readAt: String? = null,
        @kotlinx.serialization.SerialName("created_at") val createdAt: String,
        val actor: Profile? = null,
        val log: IncomingLog? = null,
        val comment: IncomingComment? = null,
    )

    @kotlinx.serialization.Serializable
    private data class IncomingLog(val id: String, val games: Game? = null)

    @kotlinx.serialization.Serializable
    private data class IncomingComment(val id: String, val body: String? = null)

    /**
     * Incoming reuses the notifications table rather than re-querying
     * the four sources with the viewer as the target. That table already
     * holds exactly "things that happened to you", already honours the
     * per-kind mute switches, and — the part worth keeping — already
     * tracks what has been read.
     */
    private suspend fun activityIncoming(userId: String, limit: Long): List<ActivityItem> {
        val cols = """
            id, kind, actor_id, log_id, comment_id, read_at, created_at,
            actor:profiles!notifications_actor_id_fkey(${Cols.PROFILE_LITE}),
            log:logs!notifications_log_id_fkey(id, games!logs_game_id_fkey(${Cols.GAME_LITE})),
            comment:comments!notifications_comment_id_fkey(id, body)
        """.trimIndent()
        return client.from("notifications").select(Columns.raw(cols)) {
            filter { eq("user_id", userId); neq("kind", "message") }
            order("created_at", Order.DESCENDING)
            limit(limit)
        }.decodeList<IncomingRow>().mapNotNull { row ->
            val unread = row.readAt == null
            when (row.kind) {
                "follow" -> ActivityItem.Followed(
                    key = "follow:${row.actorId}:$userId",
                    createdAt = row.createdAt,
                    actor = row.actor,
                    target = null,
                    targetIsViewer = true,
                    unread = unread,
                )
                "like" -> ActivityItem.Liked(
                    key = "like:${row.actorId}:${row.logId}",
                    createdAt = row.createdAt,
                    actor = row.actor,
                    game = row.log?.games,
                    logId = row.logId,
                    owner = null,
                    targetIsViewer = true,
                    unread = unread,
                )
                "comment" -> ActivityItem.Commented(
                    key = "comment:${row.commentId}",
                    createdAt = row.createdAt,
                    actor = row.actor,
                    game = row.log?.games,
                    logId = row.logId,
                    owner = null,
                    body = row.comment?.body,
                    targetIsViewer = true,
                    unread = unread,
                )
                else -> null
            }
        }
    }

    // ---- notifications -------------------------------------------------

    suspend fun unreadCount(userId: String): Long =
        client.from("notifications").select(Columns.list("id")) {
            count(io.github.jan.supabase.postgrest.query.Count.EXACT)
            filter { eq("user_id", userId); exact("read_at", null) }
        }.countOrNull() ?: 0

    suspend fun markAllRead(userId: String) {
        client.from("notifications").update(
            buildJsonObject { put("read_at", java.time.Instant.now().toString()) }
        ) {
            filter { eq("user_id", userId); exact("read_at", null) }
        }
    }

    suspend fun prefs(userId: String): NotificationPrefs =
        client.from("profiles").select(Columns.list("notification_prefs")) {
            filter { eq("id", userId) }
            limit(1)
        }.decodeSingleOrNull<PrefsWrapper>()?.notificationPrefs ?: NotificationPrefs()

    suspend fun savePrefs(userId: String, prefs: NotificationPrefs) {
        client.from("profiles").update(PrefsWrapper(prefs)) {
            filter { eq("id", userId) }
        }
    }

    suspend fun saveProfile(userId: String, displayName: String, bio: String, pronouns: String?) {
        client.from("profiles").update(
            buildJsonObject {
                put("display_name", displayName)
                put("bio", bio)
                put("pronouns", pronouns)
            }
        ) {
            filter { eq("id", userId) }
        }
    }
}
