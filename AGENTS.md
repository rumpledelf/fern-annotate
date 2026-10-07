# annotate guidance

## Documentation in Landing

This repository holds the tool's own code. Its user-facing pages and the
product documentation live in `fern-landing`; check and update them too:

- Help guide: none yet. If one is added, it goes in
  `../fern-landing/templates/pages/help-annotate.html`.
- Public intro page: `../fern-landing/templates/pages/annotate.html`.
- Product, account, access and platform docs: `../fern-landing/docs/`.

## Shared implementation policy

Before changing shared UI, controls, styling, account behavior or cross-tool
utilities, read and follow [the canonical reuse policy](../fern-landing/docs/reuse-policy.md).
Use the existing implementation directly; do not copy it or create a competing
helper. This repository entry point must remain versionable; the policy itself
is maintained in Landing.

## Independent tool releases

- Every tool must work without any sibling tool checkout. Do not import, fetch,
  embed, or serve a sibling tool's CSS, JavaScript, assets, API, or local files.
- Put any implementation needed by more than one tool in `fern-landing` and load
  it from Landing. Keep implementation used by only one tool in that tool's repo.
- A catalogue entry does not publish a tool. Tiles and the Tools menu default to
  invisible; only the ignored, per-computer `fern-landing/config/home.local.php`
  may list visible tools. Never commit that file or a machine's release list.
