# Updating the Mac mini dsh room profile

Package id: `@collab/dsh-room`. Sidebar: **DSH Room**. Launch command: **`dsh room`** (profile name = subcommand).

## Exact Mac launch

```sh
# login shell so fnm/dsh are on PATH
zsh -li -c 'dsh room --no-open --host 127.0.0.1 --port 3091'
# or with DeepSeek key from your env (never print it):
# DEEPSEEK_API_KEY="$ANTHROPIC_AUTH_TOKEN" dsh room --no-open --host 127.0.0.1 --port 3091
```

Restart helper: `~/collab-e2e/restart-mac-dsh.sh` (uses `dsh room`).

## Profile migration (collab → room)

```sh
# stop old process
pkill -f 'bin/dsh collab --no-open' || true
# rename profile directory
mv ~/.dsh/profiles/collab ~/.dsh/profiles/room
dsh plugin --profile room add /Users/cecwxf/collab-e2e/collab/packages/dsh-room
bash ~/collab-e2e/restart-mac-dsh.sh
```

## Pull latest plugin

```sh
cd ~/collab-e2e/collab
git fetch origin && git checkout master && git pull --ff-only
npm install && npm run build -w @collab/dsh-room
dsh plugin --profile room add ./packages/dsh-room
bash ~/collab-e2e/restart-mac-dsh.sh
```

## Box notes

OpenSSH in `~/.local/bin`; Tailscale userspace SOCKS for `ssh` to the Mac when needed.
