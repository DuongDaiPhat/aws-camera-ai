#!/usr/bin/env bash
set -euo pipefail

deploy_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-sender.sh"
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
cd "$fixture_dir"

printf 'def lambda_handler(event, context): pass\n' > handler.py
python -m zipfile -c sender.zip handler.py
sha256sum sender.zip > sender.zip.sha256
export MOCK_ARTIFACTS="$fixture_dir"
export MOCK_DIGEST
MOCK_DIGEST=$(openssl dgst -sha256 -binary sender.zip | base64 -w0)
export MOCK_CALLS="$fixture_dir/calls"
export GITHUB_STEP_SUMMARY="$fixture_dir/summary"
export RELEASE_ID=release-1 RELEASE_BUCKET=release-bucket
export SENDER_FUNCTION_ALIAS=
export DEPLOY_ENVIRONMENT=staging SENDER_FUNCTION_NAME=argusai-staging-sender

aws() {
  printf '%s\n' "$*" >> "$MOCK_CALLS"
  case "$1 $2" in
    's3 cp') cp "$MOCK_ARTIFACTS/${3##*/}" "$4" ;;
    'lambda get-function-configuration')
      if [[ "$*" == *Runtime* ]]; then
        printf '%s\tx86_64\t%s\n' "${MOCK_RUNTIME:-python3.12}" "${MOCK_HANDLER:-handler.lambda_handler}"
      else
        printf '%s\thandler.lambda_handler\n' "${MOCK_CODE:-$MOCK_DIGEST}"
      fi
      ;;
    'lambda get-alias')
      if [[ -f "$MOCK_ARTIFACTS/live-version" ]]; then
        cat "$MOCK_ARTIFACTS/live-version"
      elif [[ "${MOCK_ALIAS:-42}" == missing ]]; then
        echo 'ResourceNotFoundException' >&2
        return 1
      elif [[ "${MOCK_ALIAS:-42}" == denied ]]; then
        echo 'AccessDeniedException' >&2
        return 1
      else
        echo 42
      fi
      ;;
    'lambda wait'|'lambda update-function-code'|'lambda update-function-configuration') ;;
    'lambda publish-version') echo 43 ;;
    'lambda update-alias'|'lambda create-alias') echo "${MOCK_VERSION:-43}" > "$MOCK_ARTIFACTS/live-version" ;;
    *) printf 'Unexpected AWS command: %s\n' "$*" >&2; return 1 ;;
  esac
}
export -f aws

reset_calls() {
  : > "$MOCK_CALLS"
  : > "$GITHUB_STEP_SUMMARY"
  rm -f "$fixture_dir/live-version"
}

run_failure() {
  if bash "$deploy_script"; then
    echo "Expected Sender deployment to fail" >&2
    exit 1
  fi
}

assert_no_call() {
  if grep -q "$1" "$MOCK_CALLS"; then
    echo "Unexpected command matching: $1" >&2
    exit 1
  fi
}

reset_calls
if SENDER_FUNCTION_NAME= bash "$deploy_script" --check-config; then
  echo "Expected missing Sender name to fail preflight." >&2
  exit 1
fi
if SENDER_FUNCTION_NAME=argusai-production-sender bash "$deploy_script" --check-config; then
  echo "Expected a Sender from another environment to fail preflight." >&2
  exit 1
fi
bash "$deploy_script" --check-config
DEPLOY_ENVIRONMENT=production SENDER_FUNCTION_NAME=argusai-production-sender \
  bash "$deploy_script" --check-config
test ! -s "$MOCK_CALLS"

reset_calls
MOCK_HANDLER=index.handler bash "$deploy_script"
grep -q 'lambda update-function-configuration.*--handler handler.lambda_handler' "$MOCK_CALLS"
grep -q 'lambda update-alias.*--function-version 43' "$MOCK_CALLS"
grep -q 'version `42`' "$GITHUB_STEP_SUMMARY"

reset_calls
DEPLOY_ENVIRONMENT=production SENDER_FUNCTION_NAME=argusai-production-sender \
  SENDER_FUNCTION_ALIAS=release MOCK_ALIAS=missing bash "$deploy_script"
grep -q 'lambda create-alias.*argusai-production-sender --name release --function-version 43' "$MOCK_CALLS"
assert_no_call 'lambda update-function-configuration'

reset_calls
SENDER_FUNCTION_NAME=argusai-production-sender run_failure
DEPLOY_ENVIRONMENT=development run_failure
test ! -s "$MOCK_CALLS"

reset_calls
MOCK_RUNTIME=python3.11 run_failure
MOCK_ALIAS=denied run_failure
assert_no_call 'lambda update-function-code'

reset_calls
MOCK_CODE=invalid run_failure
assert_no_call 'lambda publish-version'

reset_calls
MOCK_VERSION=99 run_failure
grep -q 'lambda update-alias.*--function-version 43' "$MOCK_CALLS"

reset_calls
printf 'invalid  sender.zip\n' > sender.zip.sha256
run_failure
assert_no_call 'lambda '

reset_calls
rm sender.zip
python -m zipfile -c sender.zip sender.zip.sha256
sha256sum sender.zip > sender.zip.sha256
run_failure
assert_no_call 'lambda '

echo 'Sender deployment tests passed.'
