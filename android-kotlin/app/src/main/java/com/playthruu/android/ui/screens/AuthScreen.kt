package com.playthruu.android.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.playthruu.android.ui.theme.Ink
import com.playthruu.android.ui.theme.Space
import com.playthruu.android.ui.theme.Unbounded

/**
 * Sign in / sign up.
 *
 * Email only, on purpose. The web app also accepts a username, but that
 * path goes through a `username-login` edge function that looks the
 * handle up and swaps in the address — worth having, and not worth
 * having half-built here, where a failure would look like a wrong
 * password rather than a missing feature.
 */
@Composable
fun AuthScreen(
    busy: Boolean,
    error: String?,
    onSignIn: (String, String) -> Unit,
    onSignUp: (String, String) -> Unit,
    onErrorShown: () -> Unit,
) {
    var creating by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    val canSubmit = email.contains("@") && password.length >= 6 && !busy

    Box(
        Modifier
            .fillMaxSize()
            .padding(horizontal = Space.s4)
            .imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "Playthruu",
                fontFamily = Unbounded,
                fontWeight = FontWeight.Bold,
                fontSize = 30.sp,
                letterSpacing = (-0.6).sp,
                color = Ink.ink,
            )
            Spacer(Modifier.height(Space.s2))
            Text(
                "Your gaming diary.",
                style = MaterialTheme.typography.bodyMedium,
                color = Ink.inkDim,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(Space.s5))

            OutlinedTextField(
                value = email,
                onValueChange = { email = it; onErrorShown() },
                label = { Text("Email") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next,
                ),
                colors = fieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(Space.s3))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it; onErrorShown() },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
                colors = fieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            )

            AnimatedVisibility(error != null) {
                Text(
                    error.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = Ink.danger,
                    modifier = Modifier.fillMaxWidth().padding(top = Space.s2),
                )
            }

            Spacer(Modifier.height(Space.s4))
            Button(
                onClick = {
                    if (creating) onSignUp(email, password) else onSignIn(email, password)
                },
                enabled = canSubmit,
                shape = RoundedCornerShape(999.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Ink.accent,
                    contentColor = Ink.bg,
                    disabledContainerColor = Ink.surfaceHigh,
                    disabledContentColor = Ink.inkFaint,
                ),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                if (busy) {
                    CircularProgressIndicator(
                        color = Ink.bg,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(18.dp),
                    )
                } else {
                    Text(
                        if (creating) "Create account" else "Sign in",
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                    )
                }
            }

            Spacer(Modifier.height(Space.s2))
            TextButton(onClick = { creating = !creating; onErrorShown() }) {
                Text(
                    if (creating) "I already have an account" else "Create an account",
                    color = Ink.inkDim,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            if (password.isNotEmpty() && password.length < 6) {
                Text(
                    "Passwords are at least 6 characters.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Ink.inkFaint,
                )
            }
        }
    }
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
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
