# nightly-workflow-report

A tiny Node CLI that generates a concise **Markdown status report** for a git repo (commits + optional GitHub PR/issue lists). The output is designed to be pasted into chat (Telegram/Slack/etc.) as part of a nightly workflow.

- No dependencies (built-in Node modules only)
- Gracefully skips GitHub sections if `gh` isn’t installed or authenticated

## How to test in <10 minutes

From the repo root:

1) Show help

```bash
node tools/nightly-workflow-report/report.mjs --help
```

2) Generate a quick report for the last hour

```bash
node tools/nightly-workflow-report/report.mjs --repo . --since 1h
```

Optional: if you have GitHub CLI installed and authenticated, the report will include open PRs and issues.

```bash
gh auth status
```
