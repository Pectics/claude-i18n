---
name: apply-locale-update
description: "Use when applying the claude-i18n pending locale-update branch work: translate repository-generated JSONL chunks, run local apply validation, clean pending artifacts, and prepare the expected locale-update commit."
---

# Apply Locale Update

## Core Boundary

This skill is for the repository's `locale-update` flow. Use it when the maintainer wants the pending locale diff translated and applied locally, without writing a custom prompt. The target locale is a community-supported optional locale such as `zh-CN`, `zh-TW`, or another future locale; do not assume the workflow is Simplified-Chinese-specific.

Use the local workflow and scripts as the source of truth:

- `.github/workflows/locale-update.yml`
- `scripts/locale-update/build_diff.mjs`
- `scripts/locale-update/prepare_translation.mjs`
- `scripts/locale-update/apply_translation.mjs`
- `scripts/locale-update/shared.mjs`

Do not use web search, online translators, translation APIs, remote repositories other than the configured `origin`, generated distribution files, or unrelated translated locale files. Subagents must not read broad repository context. The primary agent may inspect the workflow, scripts, manifests, git state, and the target files needed by the local scripts.

## CI/CD Model

The GitHub Actions workflow runs on a schedule and by manual dispatch. It works on `bot/locale-update`, fetches upstream locale JSON, overwrites `.original`, and creates `.pending/locale-update` only when base-locale entries changed.

The pending directory contains:

- `manifest.json`
- `main.diff.jsonl`
- `dynamic.diff.jsonl`

The bot commit message is `chore: Update original locale files and build diff`. The local maintainer then runs this skill on the same branch to translate, apply, clear pending artifacts, and commit the result. After merge, normal deployment continues from the main branch.

## Mandatory Preflight

Before preparing or translating anything:

1. Confirm the repo root is the current workspace.
2. Confirm `origin` canonicalizes to `github.com/Pectics/claude-i18n.git`. SSH and HTTPS forms are acceptable only if they resolve to that host and path.
3. Confirm the current branch is `bot/locale-update`. If not, switch only when the worktree is clean or the current changes are unrelated and safe to leave untouched.
4. Run `git fetch origin bot/locale-update` and `git pull --rebase origin bot/locale-update`. If sandboxing blocks network access, request approval for the same command instead of skipping this step.
5. Confirm `.pending/locale-update/manifest.json`, `.pending/locale-update/main.diff.jsonl`, and `.pending/locale-update/dynamic.diff.jsonl` exist. If not, stop and report that there is no pending locale-update work to apply.
6. Inspect `git status --short`. Do not proceed if unrelated local changes would be mixed into the translation commit.

## Prepare

Run:

```bash
node scripts/locale-update/prepare_translation.mjs --locale <TARGET_LOCALE>
```

Use the default pending directory unless the user explicitly supplies another one. This script:

- reads `.pending/locale-update/manifest.json`
- reads `main.diff.jsonl` and `dynamic.diff.jsonl`
- reads the current target locale files
- removes any previous `.pending/locale-update/translation/<TARGET_LOCALE>` work directory
- writes input chunks under `.pending/locale-update/translation/<TARGET_LOCALE>/chunks/...`
- expects output chunks under `.pending/locale-update/translation/<TARGET_LOCALE>/out/...`
- writes `.pending/locale-update/translation/<TARGET_LOCALE>/manifest.json`
- writes the expected translated-value field as `outputField` in the work manifest

Read the generated work manifest and use its `chunks` array as the only assignment list. Do not invent chunk paths. Read `outputField` from the same manifest and pass that exact field name to workers. New work manifests normally use `translation`; older pending work may use the legacy `zh` field. Capture the summary counts before apply, because the apply script clears the pending directory on success.

If the manifest has no chunks because the diff only removes keys, skip translation and run the apply step directly.

## Translation Contract

Each input line is a JSON object with:

- `file`, `index`, `key`, `en`
- optional `reference`, `ja`, `op`, `beforeEn`, `currentTarget`

The source of truth is `en`. Reference fields are context only:

- use `reference` only as a hint when present
- use `ja` only as a legacy alias when the reference locale is Japanese
- use `currentTarget` only for terminology continuity
- use `beforeEn` only to understand what changed
- if any context conflicts with `en`, `en` wins

Each output line must:

- be valid JSONL
- preserve row count and order exactly
- preserve `file`, `index`, and `key` exactly
- write a non-empty translated string in the `outputField` from the work manifest

Current generated work manifests use the output field `translation`. If the manifest has no `outputField`, inspect `apply_translation.mjs`; the compatibility fallback for older pending work is `zh`.

Example shape:

```json
{"file":"main","index":0,"key":"example.key","translation":"<translated text>"}
```

Never print full translated chunks in chat. Write them to the output paths from the work manifest.

## Subagent Strategy

Use subagents only when a concrete subagent tool is visible and its file edits can be made available to the primary workspace. If subagents are unavailable, fail to spawn, write in isolated workspaces that cannot be merged, or repeatedly produce invalid chunks, use the sequential fallback.

For routine chunk translation, do not let subagents inherit an expensive frontier model by default. When the runtime supports model overrides, choose the lowest-cost model that can reliably preserve JSON, placeholders, and ICU structure. In the current runtime, a small model such as `gpt-5.4-mini` with low or medium reasoning is appropriate for normal chunks. Escalate a single difficult chunk only after concrete validation failures or semantic ambiguity show the cheaper model is insufficient.

Use a bounded pool. Assign exactly one chunk per subagent unless the user explicitly asks for larger batches. Keep the primary agent responsible for preparation, validation, apply, cleanup, staging, and commit decisions.

Do not send vague delegation prompts. Every subagent prompt must include exact input path, exact output path, target locale, output field from the work manifest, source-of-truth rules, preservation rules, quote and punctuation rules, validation expectations, and final response format.

## Execution Pitfalls

1. “Worker” means the in-product SubAgent/Worker facility. Do not invoke an external `codex` CLI process as a substitute for a Worker. When the user specifies a Worker model, select or request that model in the Worker facility; do not silently substitute another model.
2. A temporary Worker capacity failure is not a reason to downgrade the requested model. Retry the same chunk with the same Worker model, using the bounded pool, before considering a fallback. Ask the maintainer before changing models.
3. Do not inspect or validate an output path until its Worker has returned `status: done`. Reading a chunk while it is still being written can produce false structural failures.
4. Keep the configured `origin` transport unchanged. If an SSH `fetch`, `pull`, `push`, or verification command stalls or fails transiently, first retry the exact same SSH command once. Do not switch to HTTPS, rewrite URLs, change SSH host or port, or infer missing credentials unless the maintainer explicitly asks. After a successful push, verify the same branch with `git ls-remote` over the configured transport.

## Preset Subagent Prompt

Use this prompt structure when spawning subagents. Fill every placeholder before sending. Keep the hard boundaries intact.

```text
You are an offline localization worker for target locale {TARGET_LOCALE}. You own exactly one JSONL chunk.

Input chunk:
{INPUT_CHUNK_PATH}

Output chunk:
{OUTPUT_CHUNK_PATH}

Output field:
{OUTPUT_FIELD}

Hard boundaries:
1. Read the input JSONL chunk and write the output JSONL chunk.
2. Do not modify any file except the output chunk path.
3. Do not read existing target-locale files, other translated locale files, generated distribution files, git history, remote repositories, websites, or online translation services.
4. Do not use translator APIs, browser translation, web search, or special translation scripts.
5. Do not print translated chunk content in chat.

Input rules:
1. Each input line contains file, index, key, en, and may contain reference, ja, op, beforeEn, currentTarget.
2. Translate according to en. If reference exists, use it only as contextual help.
3. If en and any context conflict, en wins.
4. If currentTarget exists, use it only for terminology continuity; do not mechanically reuse it.
5. If beforeEn exists, use it only to understand the source change.
6. If ja exists, treat it only as a legacy Japanese-reference alias, not as the source of truth.

Output rules:
1. Output JSONL with one object per input row.
2. Preserve row count and row order exactly.
3. Preserve file, index, and key exactly.
4. Write only the translated value in the {OUTPUT_FIELD} field.
5. Every translated value must be a non-empty string.
6. The output file must be valid JSONL. Prefer JSON.stringify or an equivalent JSON-safe writer if you generate rows programmatically.

Style rules:
1. Use natural, modern target-locale UI wording.
2. Keep UI labels short and product-like.
3. Keep explanatory copy complete and fluent.
4. Translate sample prompts conversationally without changing task intent.
5. Preserve the source meaning first; do not over-localize product behavior.
6. Avoid unnatural calques from any reference field.

Quote and punctuation rules:
1. Source straight quotation marks around human-language text are punctuation, not protected syntax.
2. Render human-language quotes and surrounding punctuation using common target-locale writing conventions.
3. If the target locale has multiple common quote styles, choose the style most natural for contemporary UI prose and use it consistently.
4. Do not keep escaped straight quotes from the source merely to avoid JSON escaping.
5. Do not choose an unusual quote style merely to avoid JSON escaping.
6. Preserve straight quotes only when they are part of code, commands, paths, placeholders, HTML/XML attributes, URLs, emails, backtick spans, or another literal syntax.
7. Never write raw unescaped straight quotes inside a JSON string.

Must preserve exactly:
1. Product and technical names unless the source clearly uses a generic word.
2. File paths, commands, environment variables, URLs, emails, domains, model names, keyboard shortcuts, and code snippets.
3. Placeholders such as {name}, {count}, {date}.
4. HTML/XML tag names, attributes, and pairing such as <link>...</link> and <b>...</b>.
5. ICU MessageFormat variable names, plural/select branches, one, other, =0, #, and number/date/time formats.
6. Backtick spans.
7. Newlines, Markdown markers, bullets, and meaningful spacing.

Self-check before finishing:
1. Output line count equals input line count.
2. Row order and file/index/key match exactly.
3. No translated value is empty.
4. No translated value contains the replacement character, TODO, or obvious untranslated prose.
5. Placeholder, tag, URL, email, code, backtick, and ICU structures are preserved.
6. The file parses as JSONL.

Final response only:
output: {OUTPUT_CHUNK_PATH}
count: <number of rows>
status: done
```

## Sequential Fallback

When subagents are unavailable or unsuitable, process chunks one at a time using the same rules as the preset prompt. If the runtime has a plan or checklist tool, create a visible chunk checklist and update it as chunks complete. For many chunks, group visible plan items by small ranges, but still validate every individual chunk.

Do not lower quality expectations in fallback mode. Write each chunk to the manifest-provided output path, then perform structural checks before moving to the next chunk.

## Validation

Validate every output chunk before apply:

- input and output line counts match
- output parses as JSONL
- row order and `file`/`index`/`key` match exactly
- translated field is present, a string, and non-empty
- no replacement character, TODO marker, or obvious untranslated prose
- placeholders, brace structures, ICU branches, tags, URLs, emails, code spans, backtick spans, and Markdown structure are preserved
- human-language quotes follow target-locale conventions while JSON remains valid
- target-locale-specific checks are respected; for example, Chinese-family locales still reject obvious untranslated English, while Latin-script target locales are not rejected merely for using Latin letters

The authoritative validation happens in:

```bash
node scripts/locale-update/apply_translation.mjs --locale <TARGET_LOCALE>
```

Run it only after all chunk outputs exist. If it fails, fix the specific chunk/key it reports and rerun. If it succeeds, it writes the production target files and removes `.pending/locale-update`.

## Apply And Cleanup

After all chunks are valid, run:

```bash
node scripts/locale-update/apply_translation.mjs --locale <TARGET_LOCALE>
```

Expected successful behavior:

- rebuilds `<TARGET_LOCALE>/<TARGET_LOCALE>.json`
- rebuilds `<TARGET_LOCALE>/<TARGET_LOCALE>.dynamic.json`
- removes keys marked `remove`
- applies translated values for `add` and `update`
- preserves existing target values for unchanged keys
- deletes `.pending/locale-update`

After apply, confirm `.pending/locale-update` no longer exists. Never commit a still-present `.pending` translation work directory. If pending artifacts remain, stop and investigate before staging.

## Post-Apply Checks

Run `git status --short` and `git diff --name-status`.

Expected changes are:

- modified production locale files for `<TARGET_LOCALE>`
- deleted `.pending/locale-update/...` files only if those pending artifacts were tracked on the current branch

There must be no added or modified `.pending` files, no `.original` changes from the local run, and no unrelated files. If unexpected files changed, do not stage them.

Perform a lightweight count sanity check before committing:

- before apply, record each file's `add`, `update`, and `remove` counts from the pending manifest or `*.diff.jsonl`
- after apply, compare the production file diff with the expected changed value-line count: `add + remove + (update * 2)`
- count changed JSON value lines with a narrow diff view such as `git diff --unified=0 -- <TARGET_FILE>` and inspect lines beginning with `+` or `-` for JSON keys
- verify that files with zero diff rows did not receive production changes
- spot-check additions, updates, removals, placeholders, and quoted prose

This count check is a sanity signal, not a replacement for `apply_translation.mjs` validation.

## Commit

Inspect recent commit subjects before choosing the message:

```bash
git log -10 --format=%s
```

Use the repository's established style. For this workflow, the human translation commit normally follows:

```text
chore: Apply <TARGET_LOCALE> translations and build diff
```

Stage narrowly. Prefer explicit paths, for example:

```bash
git add <TARGET_LOCALE>/<TARGET_LOCALE>.json <TARGET_LOCALE>/<TARGET_LOCALE>.dynamic.json
git add -u .pending/locale-update
```

Use the second command only to record deletion of tracked pending artifacts. Do not use `git add -A` for the translation commit. Before committing, re-run `git status --short` and confirm the staged set matches the expected changes.

## Completion Report

At the end, report:

- target locale
- output field used
- prepare/apply commands run
- number of chunks translated
- whether `.pending/locale-update` was cleared
- files staged or committed
- validation result

If the work was not committed, say exactly what remains for the maintainer to do.
