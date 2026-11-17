#!/usr/bin/env bash
set -Eeuo pipefail

app_url=${APP_URL:?APP_URL is required}
app_url=${app_url%/}
release_id=${RELEASE_ID:-}
internal_token=${SMOKE_INTERNAL_TOKEN:-}
bearer_token=${SMOKE_BEARER_TOKEN:-}
refresh_token=${SMOKE_REFRESH_TOKEN:-}
test_email=${SMOKE_TEST_EMAIL:-}
test_password=${SMOKE_TEST_PASSWORD:-}
face_function=${FACE_FUNCTION_NAME:-}
face_alias=${FACE_FUNCTION_ALIAS:-live}

echo "==> 1. API health and web proxy checks ($app_url)"
health_json=$(curl --fail --silent --show-error --retry 6 --retry-all-errors --retry-delay 5 \
  "$app_url/api/v1/health")
if [[ -n $release_id ]]; then
  echo "$health_json" | jq -e --arg release "$release_id" '.status == "ok" and .version == $release' >/dev/null
else
  echo "$health_json" | jq -e '.status == "ok"' >/dev/null
fi
curl --fail --silent --show-error "$app_url/login" >/dev/null

auth_config=$(curl --fail --silent --show-error "$app_url/api/v1/auth/config")
provider=$(echo "$auth_config" | jq -er '.provider')
[[ $provider == "jwt" || $provider == "cognito" ]] || {
  echo "Unexpected auth provider: $provider" >&2
  exit 1
}
echo "    Health & auth config OK (provider=$provider)"

echo "==> 2. Auth guard negative checks (401 without credentials)"
unauth_me_code=$(curl --silent --output /dev/null --write-out '%{http_code}' "$app_url/api/v1/auth/me")
test "$unauth_me_code" = "401"
unauth_smoke_code=$(curl --silent --output /dev/null --write-out '%{http_code}' "$app_url/api/v1/internal/smoke")
test "$unauth_smoke_code" = "401"
echo "    Auth guards OK (401 on unauthenticated /auth/me and /internal/smoke)"

if [[ -n $internal_token ]]; then
  echo "==> 3. Internal API + DB + Auth + Storage/S3 + CloudQueue smoke"
  smoke_body=$(mktemp)
  trap 'rm -f "$smoke_body"' EXIT
  smoke_code=$(curl --silent --show-error --output "$smoke_body" --write-out '%{http_code}' \
    -H "x-internal-token: $internal_token" \
    "$app_url/api/v1/internal/smoke")
  jq '{status,version,checks}' "$smoke_body"
  test "$smoke_code" = "200"
  jq -e '
    .status == "ok" and
    .checks.database.status == "ok" and
    .checks.auth.status == "ok" and
    .checks.storage.status == "ok" and
    .checks.cloudQueue.status == "ok"
  ' "$smoke_body" >/dev/null
  echo "    Internal dependency smoke OK"
else
  echo "==> 3. Internal dependency smoke skipped externally (SMOKE_INTERNAL_TOKEN not set; verified on host during deploy)"
fi

if [[ -z $bearer_token && $provider == "cognito" && -n $refresh_token ]]; then
  echo "==> 4a. Exchanging Cognito refresh token for OIDC access token"
  cognito_domain=$(echo "$auth_config" | jq -er '.cognito.domain')
  client_id=$(echo "$auth_config" | jq -er '.cognito.clientId')
  token_res=$(curl --fail --silent --show-error -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "grant_type=refresh_token" \
    --data-urlencode "client_id=$client_id" \
    --data-urlencode "refresh_token=$refresh_token" \
    "${cognito_domain%/}/oauth2/token")
  bearer_token=$(echo "$token_res" | jq -er '.access_token')
  echo "    Cognito OAuth2 token refresh OK"
fi

if [[ -n $test_email && -n $test_password ]]; then
  echo "==> 4b. Verifying test user credentials (provider=$provider)"
  if [[ $provider == "jwt" && -z $bearer_token ]]; then
    login_payload=$(jq -nc --arg email "$test_email" --arg password "$test_password" \
      '{email:$email,password:$password}')
    login_res=$(curl --fail --silent --show-error -X POST \
      -H "Content-Type: application/json" \
      -d "$login_payload" \
      "$app_url/api/v1/auth/login")
    bearer_token=$(echo "$login_res" | jq -er '.accessToken')
    echo "    JWT login OK"
  elif [[ $provider == "cognito" ]] && command -v aws >/dev/null 2>&1; then
    client_id=$(echo "$auth_config" | jq -r '.cognito.clientId // empty')
    cognito_region=$(echo "$auth_config" | jq -r '.cognito.authority // empty' | sed -n 's|https://cognito-idp\.\([^.]*\)\.amazonaws\.com/.*|\1|p')
    cognito_region=${cognito_region:-${AWS_REGION:-ap-southeast-1}}
    if [[ -n $client_id ]]; then
      cognito_token=$(aws cognito-idp initiate-auth \
        --no-sign-request \
        --region "$cognito_region" \
        --auth-flow USER_PASSWORD_AUTH \
        --client-id "$client_id" \
        --auth-parameters "USERNAME=$test_email,PASSWORD=$test_password" \
        --query 'AuthenticationResult.AccessToken' \
        --output text)
      test -n "$cognito_token" && test "$cognito_token" != "None"
      echo "    Cognito USER_PASSWORD_AUTH credential check OK (note: InitiateAuth tokens lack 'openid' scope for /auth/me)"
    fi
  fi
fi

if [[ -n $bearer_token ]]; then
  echo "==> 5. Authenticated API + DB read smoke (/auth/me, /cameras, /events)"
  curl --fail --silent --show-error -H "Authorization: Bearer $bearer_token" \
    "$app_url/api/v1/auth/me" | jq -e '.id != null and .role != null' >/dev/null
  curl --fail --silent --show-error -H "Authorization: Bearer $bearer_token" \
    "$app_url/api/v1/cameras" | jq -e '.data | type == "array"' >/dev/null
  curl --fail --silent --show-error -H "Authorization: Bearer $bearer_token" \
    "$app_url/api/v1/events?limit=1" | jq -e '.data | type == "array"' >/dev/null
  echo "    Authenticated API & DB reads OK"
else
  echo "==> 5. Authenticated user API smoke skipped (no SMOKE_BEARER_TOKEN or credentials)"
fi

if [[ -n $face_function ]]; then
  echo "==> 6. Face Lambda + S3/SQS config & invocation smoke ($face_function:$face_alias)"
  fn_cfg=$(aws lambda get-function-configuration \
    --function-name "$face_function:$face_alias" \
    --output json)
  echo "$fn_cfg" | jq -e '
    .State == "Active" and
    .LastUpdateStatus == "Successful" and
    (.Environment.Variables.S3_BUCKET // "") != "" and
    (.Environment.Variables.APPLICATION_RESULTS_QUEUE_URL // "") != ""
  ' >/dev/null

  invoke_out=$(mktemp)
  trap 'rm -f "${smoke_body:-}" "$invoke_out"' EXIT
  invoke_meta=$(aws lambda invoke \
    --function-name "$face_function:$face_alias" \
    --payload '{"Records":[]}' \
    --cli-binary-format raw-in-base64-out \
    "$invoke_out")
  echo "$invoke_meta" | jq -e '.StatusCode == 200 and (.FunctionError == null or .FunctionError == "")' >/dev/null
  jq -e '.batchItemFailures == []' "$invoke_out" >/dev/null
  echo "    Face Lambda invocation smoke OK"
fi

echo "All staging smoke checks passed."
