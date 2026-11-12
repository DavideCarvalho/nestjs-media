---
"@dudousxd/nestjs-media-dashboard": minor
---

Developer tools and the console switcher. With the agent's MCP server in the app, the console is served as `media_*` tools on `/mcp/aviary` (`media_list_disks`, `media_list_objects`, `media_get_object`, `media_list_uploads`, `media_get_upload`, `media_list_collections`, `media_get_media`, and with `actions: true` `media_abort_upload` and `media_delete_objects`), gated by the console's `authorize`. New `devTools` option (default: on when the routes are mounted). When other Aviary consoles are mounted, the console's brand becomes a menu linking to the ones the viewer may open; new `GET <apiBasePath>/consoles`, behind the console's `authorize`, and the page carries a JSON config block (`media-dashboard-config`). New `anyAuthorize(...forms)`; an allowing decision may name its `caller` (`authorizeByToken` answers `token:<hash>`).
