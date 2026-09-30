#!/bin/bash
# Copies the settings (API keys) of both Vercel projects to Supabase Edge Function secrets, so the
# code that moved to Supabase has the same keys. Nothing is printed: the values go from Vercel to a
# temporary file to Supabase, and the file is deleted. Needs `npx vercel login` and `supabase login`.
#   bash scripts/edge-secrets.sh
set -euo pipefail
REF=bcmwypjrahtxogytsvuc
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
out="$work/secrets.env"
: > "$out"

for project in actuent-public actuent-private; do
  dir="$work/$project"
  mkdir -p "$dir"
  npx -y vercel@latest link --cwd "$dir" --project "$project" --yes >/dev/null 2>&1
  npx -y vercel@latest env pull "$dir/.env" --cwd "$dir" --environment=production --yes >/dev/null 2>&1
  # SUPABASE_* names are reserved on Supabase (it sets SUPABASE_URL itself); the service key travels
  # as ACTUENT_SERVICE_KEY. Vercel's own VERCEL_* values aren't needed.
  grep -E '^[A-Z0-9_]+=' "$dir/.env" | grep -vE '^(VERCEL_|TURBO_|NX_|SUPABASE_URL=)' \
    | sed 's/^SUPABASE_SERVICE_KEY=/ACTUENT_SERVICE_KEY=/' >> "$out" || true
done

# Later lines win for the same name: keep the first (public) value and say which were empty.
awk -F= '!seen[$1]++' "$out" > "$out.unique"
empty=$(awk -F= '$2=="" || $2=="\"\"" {print $1}' "$out.unique" | tr '\n' ' ')
grep -vE '^[A-Z0-9_]+=("")?$' "$out.unique" > "$out.set" || true
echo "Copying $(wc -l < "$out.set" | tr -d ' ') settings to Supabase (names only): $(cut -d= -f1 "$out.set" | tr '\n' ' ')"
supabase secrets set --project-ref "$REF" --env-file "$out.set" >/dev/null
if [ -n "$empty" ]; then echo "Vercel didn't hand these over (marked Sensitive): $empty — add them in Supabase → Edge Functions → Secrets."; fi
echo "Done."
