#!/usr/bin/env bash
set -Eeuo pipefail
: "${RELEASE_ID:?}" "${EC2_INSTANCE_ID:?}"
[[ $RELEASE_ID =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || exit 2
[[ $EC2_INSTANCE_ID =~ ^i-[0-9a-f]+$ ]] || exit 2
params=$(jq -nc --arg command "/opt/camerai/deploy-host.sh $RELEASE_ID apply" \
  '{commands:[$command],executionTimeout:["1800"]}')
command_id=$(aws ssm send-command --document-name AWS-RunShellScript \
  --instance-ids "$EC2_INSTANCE_ID" --parameters "$params" \
  --timeout-seconds 120 --query Command.CommandId --output text)
echo "SSM command: $command_id"
for ((attempt=1; attempt<=210; attempt++)); do
  if result=$(aws ssm get-command-invocation --command-id "$command_id" \
    --instance-id "$EC2_INSTANCE_ID" --output json 2>ssm-error.txt); then
    status=$(jq -r .Status <<< "$result")
    case "$status" in
      Success) echo 'Host deploy succeeded'; exit 0 ;;
      Failed|Cancelled|TimedOut|Cancelling)
        jq '{Status,StandardOutputContent,StandardErrorContent}' <<< "$result"
        exit 1 ;;
      Pending|InProgress|Delayed) ;;
      *) echo "Unexpected SSM status: $status"; exit 1 ;;
    esac
  elif ! grep -q InvocationDoesNotExist ssm-error.txt; then
    cat ssm-error.txt >&2
    exit 1
  fi
  sleep 10
done
echo 'Timed out waiting; inspect SSM before retrying. Do not assume host stopped.'
exit 1
