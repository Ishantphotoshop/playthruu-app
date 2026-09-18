package com.playthruu.android.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The shapes that come back from PostgREST, as real types.
 *
 * Every nullable field here is nullable in the database too — this is
 * deliberately not a wishlist of what would be convenient. A profile
 * genuinely can have no display name, a log genuinely can have no
 * rating, and a notification's actor genuinely can be gone if they
 * deleted their account. Modelling that honestly is what stops the app
 * crashing on the one row that does not look like the others.
 */

@Serializable
data class Profile(
    val id: String,
    val username: String? = null,
    @SerialName("display_name") val displayName: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null,
    val bio: String? = null,
    val pronouns: String? = null,
    @SerialName("pronouns_custom") val pronounsCustom: String? = null,
    @SerialName("comment_permission") val commentPermission: String? = null,
) {
    /** What to actually print. Falls through name → handle → something. */
    val name: String get() = displayName?.takeIf { it.isNotBlank() } ?: username ?: "Someone"
    val handle: String get() = username?.let { "@$it" } ?: ""
    val initials: String
        get() = name.trim().split(Regex("\\s+"))
            .mapNotNull { it.firstOrNull()?.uppercaseChar() }
            .take(2).joinToString("")
            .ifEmpty { "?" }
}

@Serializable
data class Game(
    val id: String,
    val title: String,
    @SerialName("cover_url") val coverUrl: String? = null,
    @SerialName("background_url") val backgroundUrl: String? = null,
    val genre: String? = null,
    val platform: String? = null,
    @SerialName("release_year") val releaseYear: Int? = null,
    @SerialName("studio_name") val studioName: String? = null,
    val description: String? = null,
    @SerialName("igdb_id") val igdbId: Int? = null,
) {
    /** "2024 · Adventure" — whatever of it exists. */
    val meta: String
        get() = listOfNotNull(
            releaseYear?.toString(),
            genre?.split(",")?.firstOrNull()?.trim()?.takeIf { it.isNotBlank() },
        ).joinToString(" · ")
}

@Serializable
data class GameLog(
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("game_id") val gameId: String,
    val rating: Double? = null,
    val review: String? = null,
    val status: String = "played",
    @SerialName("played_date") val playedDate: String? = null,
    @SerialName("is_replay") val isReplay: Boolean = false,
    @SerialName("contains_spoilers") val containsSpoilers: Boolean = false,
    @SerialName("is_public") val isPublic: Boolean = true,
    @SerialName("hours_played") val hoursPlayed: Double? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    // Embedded by the select; named for the constraint PostgREST uses.
    val games: Game? = null,
    val profiles: Profile? = null,
)

/** What the composer writes; separate from GameLog so the id and the
 *  embedded rows cannot accidentally be sent back to the server. */
@Serializable
data class LogDraft(
    @SerialName("user_id") val userId: String,
    @SerialName("game_id") val gameId: String,
    val rating: Double? = null,
    val review: String? = null,
    val status: String = "played",
    @SerialName("played_date") val playedDate: String? = null,
    @SerialName("is_public") val isPublic: Boolean = true,
)

@Serializable
data class LogLike(
    @SerialName("user_id") val userId: String,
    @SerialName("log_id") val logId: String,
)

@Serializable
data class Follow(
    @SerialName("follower_id") val followerId: String,
    @SerialName("following_id") val followingId: String,
)

@Serializable
data class FollowingId(@SerialName("following_id") val followingId: String)

@Serializable
data class NotificationRow(
    val id: String,
    @SerialName("user_id") val userId: String,
    val kind: String,
    @SerialName("actor_id") val actorId: String? = null,
    @SerialName("log_id") val logId: String? = null,
    @SerialName("comment_id") val commentId: String? = null,
    @SerialName("conversation_id") val conversationId: String? = null,
    @SerialName("read_at") val readAt: String? = null,
    @SerialName("created_at") val createdAt: String,
    val actor: Profile? = null,
)

@Serializable
data class NotificationPrefs(
    val follow: Boolean = true,
    val like: Boolean = true,
    val comment: Boolean = true,
    val message: Boolean = true,
    val sound: Boolean = true,
    val push: Boolean = false,
)

@Serializable
data class PrefsWrapper(
    @SerialName("notification_prefs") val notificationPrefs: NotificationPrefs? = null,
)

/**
 * One row in the activity stream, whatever table it came from.
 *
 * A sealed class rather than one struct with every field nullable: the
 * screen renders a different sentence per kind, and the compiler
 * checking that every kind is handled is worth more here than the
 * convenience of a single flat type. Adding a kind later then fails to
 * compile until the UI accounts for it, which is exactly what should
 * happen.
 */
sealed interface ActivityItem {
    val key: String
    val createdAt: String
    val actor: Profile?
    /** Only incoming rows have one; it is what the unread dot reads. */
    val unread: Boolean get() = false

    data class Logged(
        override val key: String,
        override val createdAt: String,
        override val actor: Profile?,
        val log: GameLog,
        val game: Game,
    ) : ActivityItem

    data class Liked(
        override val key: String,
        override val createdAt: String,
        override val actor: Profile?,
        val game: Game?,
        val logId: String?,
        val owner: Profile?,
        val targetIsViewer: Boolean,
        override val unread: Boolean = false,
    ) : ActivityItem

    data class Followed(
        override val key: String,
        override val createdAt: String,
        override val actor: Profile?,
        val target: Profile?,
        val targetIsViewer: Boolean,
        override val unread: Boolean = false,
    ) : ActivityItem

    data class Commented(
        override val key: String,
        override val createdAt: String,
        override val actor: Profile?,
        val game: Game?,
        val logId: String?,
        val owner: Profile?,
        val body: String?,
        val targetIsViewer: Boolean,
        override val unread: Boolean = false,
    ) : ActivityItem
}

/** The scope tabs on the activity screen: whose activity this is. */
enum class ActivityScope(val label: String) {
    FRIENDS("Friends"),
    YOU("You"),
    INCOMING("Incoming"),
}
