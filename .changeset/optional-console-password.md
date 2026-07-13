---
'@dudousxd/nestjs-media-dashboard': patch
---

Docs + regression tests confirming the console's built-in `auth.login` hook already receives the
submitted password verbatim end-to-end — including an empty string, since `AuthScreen`'s password
input never marks the field `required` and `MediaConsoleAuthController` only checks the body value
is a string, not a non-empty one. No code path was blocking empty passwords; this closes the gap
for hosts whose `login` hook gates on username alone (e.g. email must be an active admin) and
deliberately ignores the password. Documented the pass-through in the dashboard config reference
and added tests asserting: the hook is called with `''`, a hook rejecting an empty password still
uniform-fails with `401`, and a hook accepting one mints the session.
