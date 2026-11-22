#!/usr/bin/env bash
set -euo pipefail

case "${DEPLOY_ENVIRONMENT:-}" in
  staging|production) ;;
  *) echo "Sender deployment requires staging or production." >&2; exit 1 ;;
esac

function_name="${SENDER_FUNCTION_NAME:?Sender function is required}"
if [[ "$function_name" != "argusai-$DEPLOY_ENVIRONMENT-sender" ]]; then
  echo "Sender function does not match deployment environment." >&2
  exit 1
fi

alias_name="${SENDER_FUNCTION_ALIAS:-live}"
zip_key="releases/${RELEASE_ID:?Release ID is required}/sender.zip"
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
cd "$temp_dir"

aws s3 cp "s3://${RELEASE_BUCKET:?Release bucket is required}/$zip_key" sender.zip
aws s3 cp "s3://$RELEASE_BUCKET/$zip_key.sha256" sender.zip.sha256
expected_sha=$(awk 'NR == 1 {print $1}' sender.zip.sha256)
printf '%s  sender.zip\n' "$expected_sha" | sha256sum -c -
expected_b64=$(openssl dgst -sha256 -binary sender.zip | base64 -w0)
unzip -Z1 sender.zip | awk '$0 == "handler.py" { found = 1 } END { exit !found }'

read -r runtime architecture handler < <(
  aws lambda get-function-configuration --function-name "$function_name" \
    --query '[Runtime, Architectures[0], Handler]' --output text
)
if [[ "$runtime" != python3.12 || "$architecture" != x86_64 ]]; then
  echo "Sender Lambda must use Python 3.12 on x86_64." >&2
  exit 1
fi

alias_error="$temp_dir/alias-error"
if previous=$(aws lambda get-alias --function-name "$function_name" --name "$alias_name" \
  --query FunctionVersion --output text 2>"$alias_error"); then
  printf 'Sender rollback target: `%s:%s` version `%s`\n' \
    "$function_name" "$alias_name" "$previous" >> "$GITHUB_STEP_SUMMARY"
elif grep -q 'ResourceNotFoundException' "$alias_error"; then
  previous=none
else
  cat "$alias_error" >&2
  exit 1
fi

aws lambda update-function-code --function-name "$function_name" \
  --s3-bucket "$RELEASE_BUCKET" --s3-key "$zip_key" --query CodeSha256 --output text
aws lambda wait function-updated-v2 --function-name "$function_name"
if [[ "$handler" != handler.lambda_handler ]]; then
  aws lambda update-function-configuration --function-name "$function_name" \
    --handler handler.lambda_handler --query Handler --output text
  aws lambda wait function-updated-v2 --function-name "$function_name"
fi

read -r actual_b64 actual_handler < <(
  aws lambda get-function-configuration --function-name "$function_name" \
    --query '[CodeSha256, Handler]' --output text
)
[[ "$actual_b64" == "$expected_b64" && "$actual_handler" == handler.lambda_handler ]]
version=$(aws lambda publish-version --function-name "$function_name" \
  --code-sha256 "$expected_b64" --query Version --output text)
alias_action=update-alias
if [[ "$previous" == none ]]; then alias_action=create-alias; fi
aws lambda "$alias_action" --function-name "$function_name" --name "$alias_name" \
  --function-version "$version" >/dev/null
verified_version=$(aws lambda get-alias --function-name "$function_name" \
  --name "$alias_name" --query FunctionVersion --output text)
[[ "$verified_version" == "$version" ]]
printf 'Sender Lambda: `%s:%s` -> version `%s` (previous: `%s`)\n' \
  "$function_name" "$alias_name" "$verified_version" "$previous" >> "$GITHUB_STEP_SUMMARY"
