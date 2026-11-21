# Allo Outings: Rednote posts

This branch (`rednote-posts`) holds only the hand-written Rednote (小红书) posts for the admin's Posts panel:
`posts/<id>.yaml` and the ready-made pictures in `posts/pictures/`. It shares no history with `main`.

- **To publish or change a post:** commit the YAML here and push to `rednote-posts`. No pull request.
  `.github/workflows/posts.yml` checks every post, draws only the posts this push changed (with the drawing
  code from `main`) and uploads them. A few minutes later the post is in the admin under its code.
- **Old posts stay as they were drawn.** Changing the drawing code on `main` doesn't redraw them. To redraw
  one: Actions → Posts → Run workflow, with its code (e.g. W7KB) or `all`.
- The format and the checks are in `scripts/posts.mts` and `src/lib/rednote.ts` on `main`.
- Keep `.github/workflows/posts.yml` the same as on `main`.
