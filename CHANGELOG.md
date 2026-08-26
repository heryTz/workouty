# Changelog

## 1.0.0 (2026-08-26)


### ⚠ BREAKING CHANGES

* **infra:** powersync now runs herytz/workouty-powersync:${IMAGE_TAG} rather than journeyapps/powersync-service, so that image must exist at the tag being deployed — the same release publishes it alongside api and web. The db-bootstrap service is removed, so redeploy with --remove-orphans:
* **infra:** PUBLIC_API_URL and PUBLIC_POWERSYNC_URL no longer do anything in .env.prod and are removed from the example. Expo inlines those URLs into the JS bundle, so they are now fixed by the release workflow's EXPO_PUBLIC_* secrets at image build time; a published web image serves one origin only. Deploy with `up -d --pull always --wait` instead of `--build`.
* **api:** APP_RESET_URL_BASE is now APP_WEB_URL, and its value drops the trailing `/reset` — https://app.example.com, not https://app.example.com/reset. A deployment that keeps the old name falls back to the built-in default and mails unreachable reset links; one that keeps the old value mails links to `/reset/reset`. compose.prod.yml derives it from PUBLIC_WEB_URL, so prod stacks setting that need no change.
* **infra:** the `postgres` service is now `db` and its volume `pg_data` is now `db_data`. A deployment with existing data must copy the volume across before redeploying, and redeploy with `--remove-orphans`:

### Features

* **api:** add dips, cable chest flies and chest-supported rows ([#25](https://github.com/heryTz/workouty/issues/25)) ([e7df63d](https://github.com/heryTz/workouty/commit/e7df63d8e5803fa9b776ca39410d82b740d5918a))
* **api:** add the seated row machine and cable variants ([#22](https://github.com/heryTz/workouty/issues/22)) ([12d2022](https://github.com/heryTz/workouty/commit/12d2022e2020389b6320a2033d21b200ebfc649d))
* **api:** add two built-in exercises and retire the generic triceps pushdown ([#20](https://github.com/heryTz/workouty/issues/20)) ([de3571b](https://github.com/heryTz/workouty/commit/de3571b52bb330c7cfe3756f85eac35fb3f605d7))
* **api:** expand the built-in exercise library to 73 rows ([#15](https://github.com/heryTz/workouty/issues/15)) ([022296d](https://github.com/heryTz/workouty/commit/022296d829cc6166e304cd74029c250d2b7e0844))
* **infra:** deploy prod from published Docker Hub images ([#10](https://github.com/heryTz/workouty/issues/10)) ([f5e1199](https://github.com/heryTz/workouty/commit/f5e11997e7a7c3ca2e6b36230a09e9b7f4602c76))
* **infra:** make compose.prod.yml standalone, drop the infra/ mounts ([#11](https://github.com/heryTz/workouty/issues/11)) ([cf56bb6](https://github.com/heryTz/workouty/commit/cf56bb6e7de9a632b12b1c30a5187586968fa946))
* **infra:** replicate as a least-privilege role, bootstrap dev like prod ([#8](https://github.com/heryTz/workouty/issues/8)) ([028c411](https://github.com/heryTz/workouty/commit/028c411a66a554a4fcb9e78e9b54ab94829d9646))
* **mobile:** edit and delete the sets of a past session ([#19](https://github.com/heryTz/workouty/issues/19)) ([e3855de](https://github.com/heryTz/workouty/commit/e3855de79ae4445ab979842cb2a2a5d2620f8839))
* **mobile:** install the web app as a PWA ([#28](https://github.com/heryTz/workouty/issues/28)) ([b82c9de](https://github.com/heryTz/workouty/commit/b82c9de9387955a61ec30d6a2cb5473d795ab0e3))
* **mobile:** list past sessions on a paginated history screen ([#16](https://github.com/heryTz/workouty/issues/16)) ([747129f](https://github.com/heryTz/workouty/commit/747129f111cde14071824390697765f808c59bce))
* **mobile:** preview how a movement is performed ([#24](https://github.com/heryTz/workouty/issues/24)) ([8a76412](https://github.com/heryTz/workouty/commit/8a76412344da11296d16fcd82805e726268bbac2))
* **mobile:** show a finished session's details on its own screen ([#18](https://github.com/heryTz/workouty/issues/18)) ([e473109](https://github.com/heryTz/workouty/commit/e4731098a112ec579bc3c1599d5005e7eeefa95d))
* **mobile:** swap a session's exercise for another logged the same way ([#21](https://github.com/heryTz/workouty/issues/21)) ([eda938e](https://github.com/heryTz/workouty/commit/eda938ec334b40c2edd41f26316d1b51774b82da))
* offline-first workout tracker (web) — full app ([a606667](https://github.com/heryTz/workouty/commit/a60666721a33661a90634062e46553681b082140))
* show app and API build metadata on an about screen ([#13](https://github.com/heryTz/workouty/issues/13)) ([79fc106](https://github.com/heryTz/workouty/commit/79fc106afadd8723c1cbd27db3cc635d12617bc1))
* support bodyweight and time-based exercises ([#12](https://github.com/heryTz/workouty/issues/12)) ([555aadf](https://github.com/heryTz/workouty/commit/555aadf4b237c7d9bdfe92154f1438a5539d6bf5))


### Bug Fixes

* **api:** log shoulder taps as a timed exercise ([#26](https://github.com/heryTz/workouty/issues/26)) ([0514ab5](https://github.com/heryTz/workouty/commit/0514ab5009605e3e210816e4f7a483c4f073709a))
* **mobile:** show the current session's set rest as m:ss ([#27](https://github.com/heryTz/workouty/issues/27)) ([39d1d09](https://github.com/heryTz/workouty/commit/39d1d0969adbd3226752c1407bb4f5ffc619b872))
* remove superpowers docs ([#4](https://github.com/heryTz/workouty/issues/4)) ([76f740c](https://github.com/heryTz/workouty/commit/76f740c5927bbcc46640915dee907ba282d968f3))


### Refactors

* **api:** name the frontend base URL APP_WEB_URL ([#9](https://github.com/heryTz/workouty/issues/9)) ([e6eac34](https://github.com/heryTz/workouty/commit/e6eac34cff6c78275b1ab2eba72d37c3c5537fea))
