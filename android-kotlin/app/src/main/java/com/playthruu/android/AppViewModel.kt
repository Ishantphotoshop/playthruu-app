package com.playthruu.android

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.playthruu.android.data.Profile
import com.playthruu.android.data.Repository
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Session-shaped state that outlives any one screen: who is signed in,
 * their profile, and the unread count the bell shows.
 *
 * Deliberately driven by Supabase's own sessionStatus flow rather than a
 * boolean this class sets by hand. The SDK restores a saved session on
 * launch and refreshes an expiring token on its own, so anything that
 * tracked "signed in" separately would be a second source of truth that
 * drifts — and the symptom of that drift is the app showing a signed-in
 * shell with no data in it.
 */
class AppViewModel(private val repo: Repository = Repository()) : ViewModel() {

    sealed interface Auth {
        data object Loading : Auth
        data object SignedOut : Auth
        data class SignedIn(val userId: String) : Auth
    }

    private val _auth = MutableStateFlow<Auth>(Auth.Loading)
    val auth: StateFlow<Auth> = _auth.asStateFlow()

    private val _profile = MutableStateFlow<Profile?>(null)
    val profile: StateFlow<Profile?> = _profile.asStateFlow()

    private val _unread = MutableStateFlow(0L)
    val unread: StateFlow<Long> = _unread.asStateFlow()

    private val _authError = MutableStateFlow<String?>(null)
    val authError: StateFlow<String?> = _authError.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    init {
        viewModelScope.launch {
            com.playthruu.android.data.Supa.client.auth.sessionStatus.collect { status ->
                when (status) {
                    is SessionStatus.Authenticated -> {
                        val id = status.session.user?.id
                        if (id == null) {
                            _auth.value = Auth.SignedOut
                        } else {
                            _auth.value = Auth.SignedIn(id)
                            loadMe(id)
                        }
                    }
                    is SessionStatus.NotAuthenticated -> {
                        _auth.value = Auth.SignedOut
                        _profile.value = null
                        _unread.value = 0
                    }
                    // Both of these are "we do not know yet" — showing the
                    // sign-in screen during them would flash it at somebody
                    // who is already signed in.
                    is SessionStatus.Initializing -> _auth.value = Auth.Loading
                    is SessionStatus.RefreshFailure -> _auth.value = Auth.Loading
                }
            }
        }
    }

    private fun loadMe(userId: String) {
        viewModelScope.launch {
            runCatching { repo.profile(userId) }.onSuccess { _profile.value = it }
            refreshUnread()
        }
    }

    fun refreshUnread() {
        val id = (auth.value as? Auth.SignedIn)?.userId ?: return
        viewModelScope.launch {
            // A failed count keeps the last known one rather than
            // dropping the badge to zero, which would read as "all caught
            // up" when nothing of the sort had happened.
            runCatching { repo.unreadCount(id) }.onSuccess { _unread.value = it }
        }
    }

    fun clearUnread() {
        val id = (auth.value as? Auth.SignedIn)?.userId ?: return
        _unread.value = 0
        viewModelScope.launch { runCatching { repo.markAllRead(id) } }
    }

    fun signIn(email: String, password: String) = attempt { repo.signIn(email, password) }

    fun signUp(email: String, password: String) = attempt { repo.signUp(email, password) }

    fun signOut() {
        viewModelScope.launch { runCatching { repo.signOut() } }
    }

    fun dismissAuthError() { _authError.value = null }

    private fun attempt(block: suspend () -> Unit) {
        if (_busy.value) return
        _busy.value = true
        _authError.value = null
        viewModelScope.launch {
            runCatching { block() }.onFailure {
                // Supabase's own wording is usually clearer than anything
                // this layer could invent ("Invalid login credentials"),
                // so it is passed through rather than replaced.
                _authError.value = it.message ?: "Something went wrong."
            }
            _busy.value = false
        }
    }
}
