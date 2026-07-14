#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Install the Manage Eight Sleep skill.

Usage:
  ./install.sh codex [--force]
  ./install.sh hermes [--force] [--backup-conflicts]
  ./install.sh both [--force] [--backup-conflicts]

By default, an existing installation is never overwritten. Use --force only
after reviewing the existing copy and the replacement.

CODEX_HOME and HERMES_HOME are respected when set.

For Hermes, known legacy Eight Sleep skills block installation by default.
--backup-conflicts moves them to a timestamped backup under
${HERMES_HOME:-$HOME/.hermes}/backups/manage-eight-sleep, outside the active
skills tree. The installer never edits config.yaml.
EOF
}

target=""
force=false
backup_conflicts=false

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
    --backup-conflicts)
      backup_conflicts=true
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

if [[ "$backup_conflicts" == true && "$target" == "codex" ]]; then
  printf 'Error: --backup-conflicts applies only to hermes or both.\n' >&2
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

# A shared custom home needs only one copy. De-duplicating also prevents the
# same destination from being committed twice inside one transaction.
unique_destinations=()
for destination in "${destinations[@]}"; do
  duplicate=false
  # Bash 3.2 treats an empty array expansion as unbound under `set -u`.
  for existing_destination in "${unique_destinations[@]+"${unique_destinations[@]}"}"; do
    if [[ "$destination" == "$existing_destination" ]]; then
      duplicate=true
      break
    fi
  done
  if [[ "$duplicate" == false ]]; then
    unique_destinations+=("$destination")
  fi
done
destinations=("${unique_destinations[@]}")

hermes_conflicts=()
if [[ "$target" == "hermes" || "$target" == "both" ]]; then
  for relative in "eight-sleep-mcp" "eight-sleep" "smart-home/eight-sleep"; do
    candidate="$hermes_home/skills/$relative"
    if [[ -e "$candidate" || -L "$candidate" ]]; then
      hermes_conflicts+=("$candidate")
    fi
  done
fi

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

if [[ ${#hermes_conflicts[@]} -gt 0 && "$backup_conflicts" == false ]]; then
  printf 'Refusing to install beside conflicting Hermes Eight Sleep skills:\n' >&2
  for conflict in "${hermes_conflicts[@]}"; do
    printf '  - %s\n' "$conflict" >&2
  done
  printf 'Nothing was installed. Review them, then re-run with --backup-conflicts to move them into a reversible backup.\n' >&2
  exit 1
fi

if [[ "$target" == "hermes" || "$target" == "both" ]]; then
  if [[ -f "$hermes_home/config.yaml" ]] && grep -Eiq 'eight[-_]sleep|EIGHT_SLEEP_(EMAIL|PASSWORD|ALLOW_MUTATIONS)' "$hermes_home/config.yaml"; then
    printf 'Warning: Hermes config.yaml still contains a legacy Eight Sleep marker. The installer did not edit it. Run the Hermes audit in the next steps before any write.\n' >&2
  fi
fi

# The transaction has four phases: stage every copy, prepare rollback
# containers, move reviewed Hermes conflicts, then commit every destination.
# Nothing is deleted until all commits succeed. The EXIT trap restores prior
# installations and conflicts after any failure, including a later `both`
# destination failing after an earlier one was committed.
staging_paths=()
rollback_directories=()
rollback_paths=()
installed_flags=()
moved_conflict_sources=()
moved_conflict_destinations=()
backup_root=""
transaction_complete=false

rollback_transaction() {
  local index
  local destination
  local rollback_path
  local staging
  local source
  local backup_destination
  local rollback_directory

  set +e

  # Restore destinations first. This also restores any nested staging or
  # backup paths when custom host homes overlap.
  for ((index=${#destinations[@]} - 1; index >= 0; index--)); do
    destination="${destinations[$index]}"
    rollback_path="${rollback_paths[$index]:-}"
    if [[ "${installed_flags[$index]:-false}" == true ]]; then
      rm -rf -- "$destination"
    fi
    if [[ -n "$rollback_path" && ( -e "$rollback_path" || -L "$rollback_path" ) ]]; then
      if [[ -e "$destination" || -L "$destination" ]]; then
        printf 'Rollback warning: destination is occupied and could not be restored automatically: %s\n' "$destination" >&2
      elif ! mv -- "$rollback_path" "$destination"; then
        printf 'Rollback warning: prior installation remains at %s\n' "$rollback_path" >&2
      fi
    fi
  done

  # A conflict backup may itself have lived under an overlapping custom home,
  # so restore it only after destination rollback has completed.
  for ((index=${#moved_conflict_sources[@]} - 1; index >= 0; index--)); do
    source="${moved_conflict_sources[$index]}"
    backup_destination="${moved_conflict_destinations[$index]}"
    if [[ -e "$backup_destination" || -L "$backup_destination" ]]; then
      mkdir -p -- "$(dirname -- "$source")"
      if [[ -e "$source" || -L "$source" ]]; then
        printf 'Rollback warning: conflict path is occupied; backup remains at %s\n' "$backup_destination" >&2
      elif ! mv -- "$backup_destination" "$source"; then
        printf 'Rollback warning: conflicting skill remains backed up at %s\n' "$backup_destination" >&2
      fi
    fi
  done

  # A nested staging directory can reappear only after its containing prior
  # installation is restored, which is why staging cleanup happens here.
  for staging in "${staging_paths[@]+"${staging_paths[@]}"}"; do
    if [[ -n "$staging" && ( -e "$staging" || -L "$staging" ) ]]; then
      rm -rf -- "$staging"
    fi
  done

  for rollback_directory in "${rollback_directories[@]+"${rollback_directories[@]}"}"; do
    if [[ -n "$rollback_directory" && -d "$rollback_directory" ]]; then
      rmdir -- "$rollback_directory" 2>/dev/null || true
    fi
  done
  if [[ -n "$backup_root" && -d "$backup_root" ]]; then
    # Remove only empty backup directories. If any conflict could not be
    # restored, its reversible backup must never be deleted by cleanup.
    find "$backup_root" -depth -type d -exec rmdir -- {} \; 2>/dev/null || true
  fi
}

finish_transaction() {
  local exit_status=$?
  trap - EXIT
  if [[ "$transaction_complete" != true ]]; then
    printf 'Installation failed; restoring the previous state.\n' >&2
    rollback_transaction
  fi
  exit "$exit_status"
}

trap finish_transaction EXIT

# Phase 1: prepare every copy before moving an installed or legacy skill.
for destination in "${destinations[@]}"; do
  parent="$(dirname -- "$destination")"
  if ! mkdir -p -- "$parent"; then
    printf 'Error: cannot prepare installation parent: %s\n' "$parent" >&2
    exit 1
  fi
  if ! staging="$(mktemp -d "$parent/.manage-eight-sleep.stage.XXXXXX")"; then
    printf 'Error: cannot create staging directory under %s\n' "$parent" >&2
    exit 1
  fi
  staging_paths+=("$staging")
  if ! cp -R "$source_dir/." "$staging/"; then
    printf 'Error: cannot stage the skill for %s\n' "$destination" >&2
    exit 1
  fi
  if [[ -d "$staging/scripts" ]] && ! find "$staging/scripts" -type f -name '*.mjs' -exec chmod u+x {} +; then
    printf 'Error: cannot make staged scripts executable for %s\n' "$destination" >&2
    exit 1
  fi
  if [[ ! -f "$staging/SKILL.md" ]]; then
    printf 'Error: staged skill is incomplete for %s\n' "$destination" >&2
    exit 1
  fi
done

# Phase 2: reserve same-parent rollback containers before the first commit.
for ((index=0; index < ${#destinations[@]}; index++)); do
  destination="${destinations[$index]}"
  rollback_directories[$index]=""
  rollback_paths[$index]=""
  installed_flags[$index]=false
  if [[ -e "$destination" || -L "$destination" ]]; then
    if [[ "$force" != true ]]; then
      printf 'Refusing to overwrite installation created during staging: %s\n' "$destination" >&2
      exit 1
    fi
    parent="$(dirname -- "$destination")"
    if ! rollback_directory="$(mktemp -d "$parent/.manage-eight-sleep.rollback.XXXXXX")"; then
      printf 'Error: cannot create rollback container under %s\n' "$parent" >&2
      exit 1
    fi
    rollback_directories[$index]="$rollback_directory"
    rollback_paths[$index]="$rollback_directory/original"
  fi
done

# Phase 3: move known conflicts only after all destinations are ready.
if [[ ${#hermes_conflicts[@]} -gt 0 ]]; then
  backup_parent="$hermes_home/backups/manage-eight-sleep"
  if ! mkdir -p -- "$backup_parent"; then
    printf 'Error: cannot prepare the Hermes conflict backup directory: %s\n' "$backup_parent" >&2
    exit 1
  fi
  if ! backup_root="$(mktemp -d "$backup_parent/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")"; then
    printf 'Error: cannot create a unique Hermes conflict backup.\n' >&2
    exit 1
  fi
  for conflict in "${hermes_conflicts[@]}"; do
    relative="${conflict#"$hermes_home/skills/"}"
    backup_destination="$backup_root/$relative"
    moved_conflict_sources+=("$conflict")
    moved_conflict_destinations+=("$backup_destination")
    if ! mkdir -p -- "$(dirname -- "$backup_destination")"; then
      printf 'Error: cannot prepare conflict backup for %s\n' "$conflict" >&2
      exit 1
    fi
    if ! mv -- "$conflict" "$backup_destination"; then
      printf 'Error: cannot back up conflicting Hermes skill: %s\n' "$conflict" >&2
      exit 1
    fi
  done
fi

# Phase 4: commit each staged copy. Any later failure returns through the EXIT
# trap and restores every earlier destination and conflict.
for ((index=0; index < ${#destinations[@]}; index++)); do
  destination="${destinations[$index]}"
  staging="${staging_paths[$index]}"
  rollback_path="${rollback_paths[$index]}"
  if [[ -e "$destination" || -L "$destination" ]]; then
    if [[ -z "$rollback_path" ]]; then
      printf 'Error: destination appeared during installation; refusing to overwrite it: %s\n' "$destination" >&2
      exit 1
    fi
    if ! mv -- "$destination" "$rollback_path"; then
      printf 'Error: cannot preserve the prior installation at %s\n' "$destination" >&2
      exit 1
    fi
  fi
  if ! mv -- "$staging" "$destination"; then
    printf 'Error: cannot commit the staged skill to %s\n' "$destination" >&2
    exit 1
  fi
  staging_paths[$index]=""
  installed_flags[$index]=true
done

# Every new destination is now committed. Cleanup of an old copy is
# best-effort: once this commit point is reached, a cleanup error must never
# remove the successfully installed copies or attempt an impossible partial
# rollback after another old copy was already deleted.
transaction_complete=true
trap - EXIT

for ((index=0; index < ${#rollback_directories[@]}; index++)); do
  rollback_directory="${rollback_directories[$index]}"
  if [[ -n "$rollback_directory" ]]; then
    if ! rm -rf -- "$rollback_directory"; then
      destination="${destinations[$index]}"
      host_home="${destination%/skills/manage-eight-sleep}"
      retained_parent="$host_home/backups/manage-eight-sleep/rollback-cleanup"
      retained_root=""
      if mkdir -p -- "$retained_parent" \
        && retained_root="$(mktemp -d "$retained_parent/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")" \
        && mv -- "$rollback_directory" "$retained_root/container"; then
        printf 'Warning: the new installation is active, but an old rollback container could not be removed; it was retained outside the skills tree at %s\n' "$retained_root/container" >&2
      else
        if [[ -n "$retained_root" && -d "$retained_root" ]]; then
          rmdir -- "$retained_root" 2>/dev/null || true
        fi
        printf 'Warning: the new installation is active, but an old rollback container could not be removed: %s\n' "$rollback_directory" >&2
      fi
    fi
  fi
done

for destination in "${destinations[@]}"; do
  printf 'Installed Manage Eight Sleep -> %s\n' "$destination"
done
for backup_destination in "${moved_conflict_destinations[@]+"${moved_conflict_destinations[@]}"}"; do
  printf 'Backed up conflicting Hermes skill -> %s\n' "$backup_destination"
done

cat <<'EOF'

Next steps:
  1. On a fresh machine, create the token with your own account. Choose No when
     asked to enable the helper's write tools; setup performs the first login:
     npx -y eight-sleep-mcp-unofficial@0.2.5 setup --client generic --privacy-mode summary
  2. Protect it on macOS/Linux:
     chmod 600 ~/.eight-sleep-mcp/config.json ~/.eight-sleep-mcp/tokens.json
  3. Restart the host or begin a new session so it reloads installed skills.
  4. This installs only the Eight Sleep skill. It does not connect WeChat,
     Feishu/Lark, Telegram, another messaging app, or a model provider.
EOF

if [[ "$target" == "hermes" || "$target" == "both" ]]; then
  printf '  5. For Hermes, audit legacy skills and config without printing secret values:\n'
  printf '     node %q doctor --check-hermes\n' "$hermes_home/skills/manage-eight-sleep/scripts/eight-sleep.mjs"
  cat <<'EOF'
  6. Optional messaging: run "hermes gateway setup", select a platform,
     restrict access to authorized users, then keep "hermes gateway" running.
EOF
else
  cat <<'EOF'
  5. For messaging access, configure a compatible agent or gateway separately,
     restrict it to authorized users, and keep that gateway running.
EOF
fi

cat <<'EOF'

The skill is read-first. Never share the token file or enable mutations globally.
EOF
