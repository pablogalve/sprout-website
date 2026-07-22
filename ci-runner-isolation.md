# CI runner isolation

Both self-hosted runners (`dev-mac`, `dev-mac-2`) run as LaunchAgents under the
interactive account `pablogalve`, sharing its `$HOME`, `~/fvm`, and login
keychain. That sharing is why a CI FVM operation could race the interactive
shell on `~/fvm/cache.git` and leave a checked-out repo's `remote.origin` set to
`~/fvm/cache.git` with a mirror fetch refspec — breaking `git pull`/`fetch`.

Isolation has two layers:

- **Layer A (done, in-repo):** `.github/actions/setup-fvm` sets a per-runner
  `FVM_CACHE_PATH=$HOME/fvm-ci/<RUNNER_NAME>`. No two runners — and no
  interactive shell — share one `cache.git`. This alone removes the race.
- **Layer B (this runbook, machine-side):** move both runners to a dedicated
  macOS user `ci-runner` so CI cannot touch the interactive account's `$HOME` or
  keychain at all.

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
