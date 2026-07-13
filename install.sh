#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Install the Manage Eight Sleep skill.

Usage:
  ./install.sh codex [--force]
  ./install.sh hermes [--force]
  ./install.sh both [--force]

By default, an existing installation is never overwritten. Use --force only
after reviewing the existing copy and the replacement.

CODEX_HOME and HERMES_HOME are respected when set.
EOF
}

target=""
force=false

for argument in "$@"; do
  case "$argument" in
    codex|hermes|both)
      if [[ -n "$target" ]]; then
        printf 'Error: choose exactly one target: codex, hermes, or both.\n' >&2
        exit 2
      fi
      target="$argument"
      ;;
    --force)
      force=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Error: unknown argument: %s\n\n' "$argument" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$target" ]]; then
  printf 'Error: choose a target: codex, hermes, or both.\n\n' >&2
  usage >&2
  exit 2
fi

if [[ -z "${HOME:-}" ]]; then
  printf 'Error: HOME is not set.\n' >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source_dir="$script_dir/skills/manage-eight-sleep"
codex_home="${CODEX_HOME:-$HOME/.codex}"
hermes_home="${HERMES_HOME:-$HOME/.hermes}"

if [[ ! -f "$source_dir/SKILL.md" ]]; then
  printf 'Error: skill source not found at %s\n' "$source_dir" >&2
  exit 1
fi

destinations=()
case "$target" in
  codex)
    destinations+=("$codex_home/skills/manage-eight-sleep")
    ;;
  hermes)
    destinations+=("$hermes_home/skills/manage-eight-sleep")
    ;;
  both)
    destinations+=(
      "$codex_home/skills/manage-eight-sleep"
      "$hermes_home/skills/manage-eight-sleep"
    )
    ;;
esac

# Preflight every destination before copying anything so `both` cannot leave a
# partial installation merely because the second target already exists.
blocked=false
for destination in "${destinations[@]}"; do
  if [[ -e "$destination" || -L "$destination" ]]; then
    if [[ "$force" == false ]]; then
      printf 'Refusing to overwrite existing installation: %s\n' "$destination" >&2
      blocked=true
    fi
  fi
done

if [[ "$blocked" == true ]]; then
  printf 'Nothing was installed. Re-run with --force only if replacement is intentional.\n' >&2
  exit 1
fi

install_one() {
  local destination="$1"
  local parent
  local staging

  parent="$(dirname -- "$destination")"
  mkdir -p -- "$parent"
  staging="$(mktemp -d "$parent/.manage-eight-sleep.stage.XXXXXX")"

  if ! cp -R "$source_dir/." "$staging/"; then
    rm -rf -- "$staging"
    return 1
  fi

  if [[ -d "$staging/scripts" ]]; then
    find "$staging/scripts" -type f -name '*.mjs' -exec chmod u+x {} +
  fi

  if [[ -e "$destination" || -L "$destination" ]]; then
    if [[ "$force" != true ]]; then
      rm -rf -- "$staging"
      printf 'Refusing to overwrite installation created during install: %s\n' "$destination" >&2
      return 1
    fi
    rm -rf -- "$destination"
  fi

  if ! mv -- "$staging" "$destination"; then
    rm -rf -- "$staging"
    return 1
  fi

  printf 'Installed Manage Eight Sleep -> %s\n' "$destination"
}

for destination in "${destinations[@]}"; do
  install_one "$destination"
done

cat <<'EOF'

Next steps:
  1. On a fresh machine, create the token with your own account. Choose No when
     asked to enable the helper's write tools; setup performs the first login:
     npx -y eight-sleep-mcp-unofficial@0.2.5 setup --client generic --privacy-mode summary
  2. Protect it on macOS/Linux:
     chmod 600 ~/.eight-sleep-mcp/config.json ~/.eight-sleep-mcp/tokens.json
  3. Restart the host or begin a new session so it reloads installed skills.

The skill is read-first. Never share the token file or enable mutations globally.
EOF
