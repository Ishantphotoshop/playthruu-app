package com.playthruu.android.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.playthruu.android.data.NotificationPrefs
import com.playthruu.android.data.Profile
import com.playthruu.android.data.Repository
import com.playthruu.android.ui.Avatar
import com.playthruu.android.ui.HairLine
import com.playthruu.android.ui.SectionHeading
import com.playthruu.android.ui.theme.Ink
import com.playthruu.android.ui.theme.Space
import kotlinx.coroutines.launch

/**
 * Settings. Profile fields, the notification switches folded away
 * behind their heading (six rows is a lot of space for something set
 * once — the same call the web app makes), and signing out.
 */
@Composable
fun SettingsScreen(
    profile: Profile?,
    userId: String,
    repo: Repository,
    onBack: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var displayName by remember(profile) { mutableStateOf(profile?.displayName.orEmpty()) }
    var bio by remember(profile) { mutableStateOf(profile?.bio.orEmpty()) }
    var prefs by remember { mutableStateOf(NotificationPrefs()) }
    var notifOpen by remember { mutableStateOf(false) }
    var savedNote by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(userId) {
        prefs = runCatching { repo.prefs(userId) }.getOrDefault(NotificationPrefs())
    }

    fun persist(next: NotificationPrefs) {
        prefs = next
        scope.launch { runCatching { repo.savePrefs(userId, next) } }
    }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Space.s2, vertical = Space.s2),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink.ink)
            }
            Text("Settings", style = MaterialTheme.typography.titleMedium, color = Ink.ink)
        }

        // ---- account ----
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Space.s4)
                .clip(RoundedCornerShape(16.dp))
                .background(Ink.surfaceRaised)
                .padding(Space.s3),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.s3),
        ) {
            Avatar(profile, 56.dp)
            Column {
                Text(
                    profile?.name ?: "You",
                    style = MaterialTheme.typography.titleMedium,
                    color = Ink.ink,
                )
                Text(
                    profile?.handle.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = Ink.inkDim,
                )
            }
        }

        SectionHeading("Profile")
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Space.s4)
                .clip(RoundedCornerShape(16.dp))
                .background(Ink.surfaceRaised)
                .padding(Space.s3),
            verticalArrangement = Arrangement.spacedBy(Space.s3),
        ) {
            OutlinedTextField(
                value = displayName,
                onValueChange = { displayName = it },
                label = { Text("Display name") },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                colors = settingsFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = bio,
                onValueChange = { bio = it },
                label = { Text("Bio") },
                minLines = 2,
                shape = RoundedCornerShape(12.dp),
                colors = settingsFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    scope.launch {
                        runCatching {
                            repo.saveProfile(userId, displayName, bio, profile?.pronouns)
                        }.onSuccess { savedNote = "Saved" }
                            .onFailure { savedNote = it.message ?: "Couldn't save that" }
                    }
                },
                shape = RoundedCornerShape(999.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Ink.accent, contentColor = Ink.bg),
                modifier = Modifier.fillMaxWidth().height(46.dp),
            ) {
                Text("Save profile", fontWeight = FontWeight.Bold, fontSize = 14.sp)
            }
            AnimatedVisibility(savedNote != null) {
                Text(
                    savedNote.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = Ink.inkDim,
                )
            }
        }

        // ---- notifications, folded away ----
        Row(
            Modifier
                .fillMaxWidth()
                .clickable { notifOpen = !notifOpen }
                .padding(horizontal = Space.s4, vertical = Space.s3),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "NOTIFICATIONS",
                style = MaterialTheme.typography.labelSmall,
                color = Ink.inkFaint,
                modifier = Modifier.weight(1f),
            )
            Icon(
                Icons.Filled.KeyboardArrowDown,
                contentDescription = if (notifOpen) "Collapse" else "Expand",
                tint = Ink.inkFaint,
                modifier = Modifier.rotate(if (notifOpen) 180f else 0f),
            )
        }
        AnimatedVisibility(notifOpen) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Space.s4)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Ink.surfaceRaised),
            ) {
                PrefRow("Follows", "When someone follows you", prefs.follow) {
                    persist(prefs.copy(follow = it))
                }
                HairLine()
                PrefRow("Likes", "When someone likes your review", prefs.like) {
                    persist(prefs.copy(like = it))
                }
                HairLine()
                PrefRow("Comments", "When someone comments on your review", prefs.comment) {
                    persist(prefs.copy(comment = it))
                }
                HairLine()
                PrefRow("Messages", "When someone sends you a message", prefs.message) {
                    persist(prefs.copy(message = it))
                }
                HairLine()
                PrefRow("Sound", "Ring with your phone's own notification tone", prefs.sound) {
                    persist(prefs.copy(sound = it))
                }
                HairLine()
                PrefRow("Push notifications", "Get notified on this device", prefs.push) {
                    persist(prefs.copy(push = it))
                }
            }
        }
        Text(
            "Switching one off stops it being recorded at all, so it won't ring, badge or show up in your notifications.",
            style = MaterialTheme.typography.bodySmall,
            color = Ink.inkFaint,
            modifier = Modifier.padding(horizontal = Space.s4, vertical = Space.s2),
        )

        SectionHeading("Account")
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Space.s4)
                .clip(RoundedCornerShape(16.dp))
                .background(Ink.surfaceRaised),
        ) {
            Text(
                "Log out",
                style = MaterialTheme.typography.titleSmall,
                color = Ink.danger,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onSignOut() }
                    .padding(Space.s3),
            )
        }

        Spacer(Modifier.height(Space.s5))
        Text(
            "Game data via IGDB.com · Playthruu",
            style = MaterialTheme.typography.bodySmall,
            color = Ink.inkFaint,
            modifier = Modifier.fillMaxWidth().padding(bottom = 96.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

@Composable
private fun PrefRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onChange(!checked) }
            .padding(horizontal = Space.s3, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = Ink.ink)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Ink.inkDim)
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Ink.bg,
                checkedTrackColor = Ink.accent,
                uncheckedThumbColor = Ink.inkDim,
                uncheckedTrackColor = Ink.surfaceHigh,
                uncheckedBorderColor = Ink.line,
            ),
        )
    }
}

@Composable
private fun settingsFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedContainerColor = Ink.surface,
    unfocusedContainerColor = Ink.surface,
    focusedBorderColor = Ink.accent,
    unfocusedBorderColor = Ink.lineStrong,
    focusedTextColor = Ink.ink,
    unfocusedTextColor = Ink.ink,
    cursorColor = Ink.accent,
    focusedLabelColor = Ink.accent,
    unfocusedLabelColor = Ink.inkDim,
)
