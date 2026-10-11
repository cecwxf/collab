# Updating the Mac mini collab / dsh room plugin

Package id: `@collab/dsh-room`. Sidebar: **DSH Room**. Prefer “dsh room” over “deepseek room”.

## From the box (Tailscale userspace + OpenSSH in ~/.local/bin)

```sh
export PATH="$HOME/.local/bin:$PATH"
SOCK=$HOME/.local/tailscale/tailscaled.sock
ssh -o "ProxyCommand=tailscale --socket=$SOCK nc %h %p" cecwxf@100.73.167.125 '…'
```

## On the Mac

```sh
cd ~/collab-e2e   # cecwxf/collab checkout (or linked packages)
git fetch origin && git checkout master && git pull --ff-only
npm install && npm run build -w @collab/dsh-room
# dsh is usually under a profile PATH — use the same launcher you already use for collab
dsh plugin --profile collab add ./packages/dsh-room
bash ~/collab-e2e/restart-mac-dsh.sh
```

## Restoring openssh-client on the Debian box

Apt may have no candidate. Extract `ssh`/`scp` from the Debian `.deb` with Python `lzma` + `tarfile` into `~/.local/bin` (see prior agent notes). `ssh -V` should report OpenSSH_10.
