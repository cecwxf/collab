# Updating the Mac dsh plugin when box SSH is unavailable

The shared box currently has **no `openssh-client` / `rsync` in apt** (Debian trixie candidate: none). Prefer GitHub:

```sh
# On the Mac
cd ~/collab-e2e   # or wherever you keep the checkout
git fetch origin && git checkout master && git pull --ff-only
# Refresh the dsh plugin link / install
# (adjust paths to your profile)
dsh plugin add /path/to/collab/packages/dsh-plugin
# or: rsync local clone into the profile node_modules path you already use
```

If you restore SSH on the box later:

```sh
# Extract openssh-client from a Debian .deb when apt has no candidate, e.g.
# http://ftp.debian.org/debian/pool/main/o/openssh/openssh-client_*_amd64.deb
# then: ar x … && tar xf data.tar.* && cp usr/bin/ssh ~/.local/bin/
```
