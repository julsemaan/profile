#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./port-forward.sh <config.csv>

Config format (CSV, one per line):
name,namespace,resource,local_port,remote_port,context,kubeconfig

- name:        optional label for logs
- namespace:   optional; default kubectl namespace if blank
- resource:    required; e.g. svc/my-service or pod/my-pod
- local_port:  required
- remote_port: required
- context:     optional; kubectl context
- kubeconfig:  optional; path to kubeconfig

Blank lines and lines starting with # are ignored.
USAGE
}

config="${1:-}"
if [[ -z "${config}" ]]; then
  usage
  exit 1
fi

if [[ ! -f "${config}" ]]; then
  echo "Config file not found: ${config}" >&2
  exit 1
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl not found in PATH" >&2
  exit 1
fi

supervisor_pids=()
stop_requested=0

cleanup() {
  stop_requested=1
  if (( ${#supervisor_pids[@]} )); then
    echo "Stopping port-forwards..."
    for pid in "${supervisor_pids[@]}"; do
      kill "${pid}" 2>/dev/null || true
    done
  fi
}
trap cleanup EXIT INT TERM

line_no=0
while IFS=, read -r name namespace resource local_port remote_port context kubeconfig; do
  line_no=$((line_no + 1))

  # Trim leading/trailing whitespace
  name="${name#"${name%%[![:space:]]*}"}"; name="${name%"${name##*[![:space:]]}"}"
  namespace="${namespace#"${namespace%%[![:space:]]*}"}"; namespace="${namespace%"${namespace##*[![:space:]]}"}"
  resource="${resource#"${resource%%[![:space:]]*}"}"; resource="${resource%"${resource##*[![:space:]]}"}"
  local_port="${local_port#"${local_port%%[![:space:]]*}"}"; local_port="${local_port%"${local_port##*[![:space:]]}"}"
  remote_port="${remote_port#"${remote_port%%[![:space:]]*}"}"; remote_port="${remote_port%"${remote_port##*[![:space:]]}"}"
  context="${context#"${context%%[![:space:]]*}"}"; context="${context%"${context##*[![:space:]]}"}"
  kubeconfig="${kubeconfig#"${kubeconfig%%[![:space:]]*}"}"; kubeconfig="${kubeconfig%"${kubeconfig##*[![:space:]]}"}"

  [[ "${name}" == \#* ]] && continue
  [[ -z "${resource}" ]] && continue
  [[ "${resource}" == \#* ]] && continue

  if [[ -z "${local_port}" || -z "${remote_port}" ]]; then
    echo "Missing ports on line ${line_no}" >&2
    exit 1
  fi

  kubectl_args=(kubectl)
  [[ -n "${kubeconfig}" ]] && kubectl_args+=(--kubeconfig "${kubeconfig}")
  [[ -n "${context}" ]] && kubectl_args+=(--context "${context}")
  [[ -n "${namespace}" ]] && kubectl_args+=(-n "${namespace}")

  label="${name:-${resource}}"
  echo "Starting port-forward: ${label} -> ${local_port}:${remote_port}"

  (
    set +e
    while true; do
      "${kubectl_args[@]}" port-forward "${resource}" "${local_port}:${remote_port}" >/dev/null 2>&1
      if (( stop_requested )); then
        exit 0
      fi
      echo "Port-forward exited for ${label}; retrying in 1s..." >&2
      sleep 1 
    done
  ) &
  supervisor_pids+=("$!")
done < "${config}"

if (( ${#supervisor_pids[@]} == 0 )); then
  echo "No port-forwards started." >&2
  exit 1
fi

echo "All port-forwards running. Press Ctrl+C to stop."
wait
