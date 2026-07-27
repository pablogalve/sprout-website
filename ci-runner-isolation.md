# CI runner isolation

Both self-hosted runners (`dev-mac`, `dev-mac-2`) run as LaunchAgents under the
interactive account `pablogalve`, sharing its `$HOME`, `~/fvm`, and login
keychain.

## Root cause of the recurring git corruption

Symptom: an interactive `git fetch`/`pull` on the Sprout clone fails with
`fatal: '/Users/pablogalve/fvm/cache.git' does not appear to be a git
repository`. On inspection the clone's `remote.origin.url` had been rewritten to
`~/fvm/cache.git` with a mirror fetch refspec (`+refs/heads/*:refs/heads/*`) and
`tagopt=--no-tags`, and `~/fvm/cache.git` was not a Flutter mirror at all but an
88 MB **copy of the Sprout working tree** with no `.git` inside.

The writer is FVM's **git cache** machinery. With `useGitCache` on, FVM manages a
`~/fvm/cache.git` reference clone; on this host that code path intermittently
mangled both `cache.git` (filling it with project files) and the *project's*
`remote.origin`. Because `remote.*` lives in the **shared** config across all
git worktrees of a repo, one bad write breaks the interactive clone and every
worktree at once. Per-runner cache paths did not stop it — the writer is the git
cache itself, not cross-runner contention.

## Fixes, in order of impact

- **Primary (done):** git cache disabled. Machine: `fvm config
  --no-use-git-cache`. CI: `.github/actions/setup-fvm` runs the same, so every
  runner and future runner has it off. No `cache.git` exists, so nothing can be
  injected. Cost: a new Flutter version clones directly from GitHub (one-time per
  version); installed versions are unaffected. The polluted `~/fvm/cache.git`
  was quarantined to `~/fvm/cache.git.polluted-<ts>` and can be deleted once
  confidence is high.
- **Layer A (done, in-repo):** `setup-fvm` sets a per-runner
  `FVM_CACHE_PATH=$HOME/fvm-ci/<RUNNER_NAME>` so concurrent installs never race
  one versions dir.
- **Layer B (runbook below, machine-side):** move both runners to a dedicated
  macOS user `ci-runner` so CI cannot touch the interactive account's `$HOME` or
  keychain at all — defense in depth.

### If corruption ever reappears

Repair the clone (fixes all worktrees, since the remote config is shared):

```bash
git remote set-url origin https://github.com/pablogalve/Sprout.git
git config --replace-all remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git config --unset remote.origin.tagopt || true
```

Then confirm `fvm api context` shows `"gitCache": false`; if not, re-run
`fvm config --no-use-git-cache`.

## Auto-heal guard (belt-and-suspenders)

A launchd agent watches the shared `.git/config` and, if the corruption ever
reappears, repairs `remote.origin` within ~1s and logs a forensic snapshot of
the candidate writer. It is a no-op unless the exact corruption is present, so
it never fights a legitimate remote change.

Canonical source lives in the repo:

- `scripts/sprout-git-origin-guard.sh` — detect + repair + log. Repo path is
  overridable via `SPROUT_GUARD_REPO`; log via `SPROUT_GUARD_LOG`
  (default `~/Library/Logs/sprout-origin-guard.log`).
- `scripts/com.pablogalve.sprout-origin-guard.plist` — the launchd
  `WatchPaths` agent.

Install (already done on the current host):

```bash
mkdir -p ~/.local/bin ~/Library/Logs
cp scripts/sprout-git-origin-guard.sh ~/.local/bin/
chmod +x ~/.local/bin/sprout-git-origin-guard.sh
cp scripts/com.pablogalve.sprout-origin-guard.plist ~/Library/LaunchAgents/
launchctl bootout  gui/$(id -u)/com.pablogalve.sprout-origin-guard 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pablogalve.sprout-origin-guard.plist
```

Verify: `launchctl print gui/$(id -u)/com.pablogalve.sprout-origin-guard | grep watching`
should show `watching = 1`. It re-loads automatically at login. If the guard
ever fires, `~/Library/Logs/sprout-origin-guard.log` names the process that held
the config open — that is the writer to chase upstream.

## Layer B runbook

Run on the runner host. Steps needing elevation are marked `sudo`.

### 1. Create the service account

```bash
sudo sysadminctl -addUser ci-runner -fullName "CI Runner" -password - 
sudo dseditgroup -o edit -a ci-runner -t user staff
```

`-password -` prompts interactively; give it a strong password and store it in a
password manager. Enable **auto-login** for `ci-runner` in System Settings →
Users & Groups if iOS code-signing needs an unlocked GUI login session.

### 2. Remove the old runner registrations

As `pablogalve`, for each runner directory:

```bash
cd ~/actions-runner    && ./svc.sh stop && ./svc.sh uninstall
cd ~/actions-runner-2  && ./svc.sh stop && ./svc.sh uninstall
```

Then de-register each from GitHub (needs a fresh removal token from
repo Settings → Actions → Runners → the runner → Remove):

```bash
cd ~/actions-runner    && ./config.sh remove --token <REMOVAL_TOKEN_1>
cd ~/actions-runner-2  && ./config.sh remove --token <REMOVAL_TOKEN_2>
```

### 3. Re-provision under `ci-runner`

Log in as `ci-runner` (or `su - ci-runner`). Download a fresh runner per
instance so `.env`/`.path` are generated from the new account's environment —
do NOT copy the old dirs, their `.env` bakes `pablogalve` paths.

```bash
mkdir -p ~/actions-runner ~/actions-runner-2
# download + extract the runner tarball into each (see repo Settings → Actions
# → Runners → New self-hosted runner for the current URL + checksum), then:
cd ~/actions-runner   && ./config.sh --url https://github.com/pablogalve/Sprout \
  --token <REG_TOKEN_1> --name dev-mac   --labels self-hosted,macOS --unattended
cd ~/actions-runner-2 && ./config.sh --url https://github.com/pablogalve/Sprout \
  --token <REG_TOKEN_2> --name dev-mac-2 --labels self-hosted,macOS --unattended
```

Keep the names `dev-mac` / `dev-mac-2` so Layer A's per-`RUNNER_NAME` cache paths
stay stable.

### 4. Install pinned FVM for the new user

```bash
curl -fsSL https://fvm.app/install.sh | bash -s 4.1.2
# fvm binary lands at ~/fvm/bin; cache goes to ~/fvm-ci/<RUNNER_NAME> via Layer A
```

### 5. Re-import signing identities into ci-runner's keychain

This is the deliberate, secret-handling step — do it yourself, do not script the
secrets into the repo. iOS distribution cert + provisioning profiles, and the
Android upload keystore, must live in `ci-runner`'s keychain / files. See the
prior keychain notes: the interactive login keychain's duplicate identity can
shadow the CI keychain unless the CI keychain is first in the search list
(`security list-keychains -d user -s <ci.keychain> login.keychain-db`).

### 6. Start the services and verify

```bash
cd ~/actions-runner   && ./svc.sh install && ./svc.sh start
cd ~/actions-runner-2 && ./svc.sh install && ./svc.sh start
```

Trigger a CI build and confirm the log prints
`FVM cache isolated at /Users/ci-runner/fvm-ci/dev-mac` (and `-2`), and that a
signed build succeeds.

### 7. Decommission the old shared state

Once green, as `pablogalve` remove the stale runner dirs and the CI-polluted FVM
cache:

```bash
rm -rf ~/actions-runner ~/actions-runner-2
# ~/fvm stays — it is now yours alone
```

## After migration

Your interactive `~/Developer/Github_DigitalSeneca/Sprout` clone is never touched
by CI again. If its `remote.origin` was already clobbered, repair it once:

```bash
git remote set-url origin https://github.com/pablogalve/Sprout.git
git config --replace-all remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git config --unset remote.origin.tagopt || true
```
