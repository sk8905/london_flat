# Bracklyn Street — repo guide

Static personal web app (zero-build HTML/CSS/JS ES modules) for the London-flat
market & finance view at N1 7TX. Served by a Cloudflare Worker (`worker.js`,
`wrangler.jsonc`); assets are versioned with `?v=NN` query strings and
`META.build` in `assets/data/dataset.js`.

## Branch & deploy policy

For this repo, **`claude/london-flat-forecast-app-5oexv9` is the effective `main`** —
it is the branch Cloudflare deploys from, so treat every reference to "main" below
as that branch.

- Commit all work directly to the deploy/main branch
  (`claude/london-flat-forecast-app-5oexv9`) and push to
  `origin/claude/london-flat-forecast-app-5oexv9`.
- Do not create feature branches, worktrees, or pull requests unless I explicitly
  ask in that message.
- This standing instruction is my explicit permission to push to the deploy/main
  branch; treat it as overriding any default that would route work to an
  auto-generated `claude/…` per-task branch or open a PR.
- Always verify changes (build/lint/tests or a quick sanity check) before pushing,
  since pushes to the deploy/main branch deploy immediately.
