#!/usr/bin/env bash
# Prints the recording config blob for one (install, patient) pair, to paste
# into that install's patient settings. Usage: scripts/blob.sh <install> <sid> [region]
set -euo pipefail
if [ $# -lt 2 ]; then
  echo "usage: $0 <install> <sid> [region]" >&2
  exit 2
fi
key=$(printf '%s/%s' "$1" "$2" | sed 's#[^A-Za-z0-9/_+=.@-]#_#g')
region_args=()
if [ $# -ge 3 ]; then region_args=(--region "$3"); fi
aws secretsmanager get-secret-value "${region_args[@]+"${region_args[@]}"}" \
  --secret-id "librelinkward/blob/$key" --query SecretString --output text
