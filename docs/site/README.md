# docs/site — files to publish at epurse.co.in

Reference copies of the two remote-config documents `src/config/remoteConfig.ts` fetches.
Publish each at the exact path the app requests — no redirects, no trailing slash difference:

| File here | Publish to | Fetched by |
|---|---|---|
| `app-config.json` | `https://epurse.co.in/app-config.json` | every "-prod"/prod build.sh target: `dev-prod`, `stage-prod`, `prod` |
| `app-config.test.json` | `https://epurse.co.in/app-config.test.json` | every "-test" build.sh target: `dev-test`, `stage-test`, plus plain `expo start` |

The split is by the **WHERE** axis (`build.sh`'s own `-test`/`-prod` naming — who signs the
build), carried by `EXPO_PUBLIC_BUILD_KIND`. There is no `prod-test`: a production-environment
build is only ever produced through the EAS pipeline, so it's never ambiguous which document it
should fetch.

See `[[project_remote_config_sep2026]]` (memory) / `docs/APP_LOG.md` for the full design —
in one line: FAIL OPEN on any error, an allow-list not a merge, and the test file is where you
try a lower `minSupportedVersion` or an early flag flip before it ever touches the prod file.

The test file ships with `minSupportedVersion`/`latestVersion` both `null` (no gating or nudging
noise for testers on a fresh sideload) and every section flag `true` (see whatever's in
progress). The prod file is the one that changes deliberately and rarely.
