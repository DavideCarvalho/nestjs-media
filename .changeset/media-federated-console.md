---
'@dudousxd/nestjs-media-dashboard': minor
---

Federated console: one media console on a central app shows the media of several apps, each read in place from that app's own stores. `MediaDashboardModule.forRoot({ federation: { apps: { [name]: { store?, uploads?, storage?, label? } } } })` adds an app switcher, with the selected app in the URL (`?app=<name>`, sent to the API as the `x-media-app` header); every read and action of a request is served from that app's stores. Deleting a library record and cancelling an upload session write to the selected app's store, as on the console's own app; disk writes answer 501 for a federated app, since they belong to the app's own process. An `authorize` allow may carry an `apps` grant (`'*'` or a list of app names): a list confines the viewer to those federated apps and hides the console's own. `topology` reports the switcher as `federation`.
