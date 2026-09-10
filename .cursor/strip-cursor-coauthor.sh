#!/usr/bin/env bash
# Environment hygiene only. Cursor cloud VMs may install
# commit-msg.cursor.co-author which adds Co-authored-by Cursor.
# Delete those files and keep a commit-msg hook that strips them.
set -euo pipefail

HOOKS_ROOT="/home/ubuntu/.cursor/agent-hooks"

reap_coauthor_files() {
  if [[ -d "$HOOKS_ROOT" ]]; then
    find "$HOOKS_ROOT" \( -iname '*co-author*' -o -iname '*coauthor*' \) -type f -delete 2>/dev/null || true
  fi
}

install_strip_hook() {
  local git_hooks="/workspace/.git/hooks"
  [[ -d "$git_hooks" ]] || return 0
  cat > "$git_hooks/commit-msg" << 'HOOK'
#!/usr/bin/env bash
set -euo pipefail
msg_file="$1"
tmp="$(mktemp)"
grep -viE 'Co-authored-by:.*[Cc]ursor|Made with [Cc]ursor|cursoragent@cursor\.com' "$msg_file" > "$tmp" || true
mv "$tmp" "$msg_file"
HOOK
  chmod +x "$git_hooks/commit-msg"
}

reap_coauthor_files
install_strip_hook

# Reaper: Cursor may recreate the hook at commit time. Keep it off disk.
if [[ -z "${SF_COAUTHOR_REAPER_PID:-}" ]]; then
  (
    while sleep 5; do
      reap_coauthor_files
    done
  ) >/dev/null 2>&1 &
  export SF_COAUTHOR_REAPER_PID=$!
fi

leftover="$(find "$HOOKS_ROOT" \( -iname '*co-author*' -o -iname '*coauthor*' \) -type f 2>/dev/null || true)"
if [[ -n "$leftover" ]]; then
  echo "WARNING: Cursor co-author hook still present:" >&2
  echo "$leftover" >&2
  exit 1
fi
echo "cursor co-author hooks: gone"
