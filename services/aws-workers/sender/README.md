# Notification Sender

The Lambda consumes the notification jobs queue, matches each job to its durable
backend envelope, and claims the attempt before requesting a provider send. It
stores the outcome through the internal API before publishing it to the shared
Results queue. When SQS delivery retries, a cached outcome is republished
unchanged. A backend `NO_OP` completes the job. A busy claim or a failed result
write or publication is returned to the event source mapping for retry.

## Build and configure

Run from the repository root.

```sh
python services/aws-workers/build.py --worker sender
```

The build writes `services/aws-workers/.build/sender.zip`. Deploy with Python
3.12 on x86_64, handler `handler.lambda_handler`, and a 30-second timeout. Configure
the notification jobs event source mapping with a batch size of 1 and enable
`ReportBatchItemFailures`. An existing function configured for a stub handler
needs the handler setting updated when this ZIP is deployed.

| Setting                                                                         | Value                                                                                                             |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `AWS_REGION`                                                                    | Lambda runtime Region.                                                                                            |
| `APPLICATION_RESULTS_QUEUE_URL`                                                 | Shared Results queue URL for the same environment.                                                                |
| `INTERNAL_API_BASE_URL`                                                         | Reachable HTTPS backend URL ending in `/api/v1`.                                                                  |
| `INTERNAL_SERVICE_TOKEN`                                                        | Internal API token with at least 32 characters.                                                                   |
| `APP_ENV`                                                                       | `dev`, `staging`, or `production`. The worker checks the matching `[ArgusAI][ENV]` prefix before a provider call. |
| `SENDER_DRY_RUN`                                                                | Defaults to `true`. Set to `false` for a deployment authorized for real sends by the backend.                     |
| `SNS_TOPIC_ARN`                                                                 | Exact email topic authorized by the backend.                                                                      |
| `CONNECT_INSTANCE_ID`, `CONNECT_CONTACT_FLOW_ID`, `CONNECT_SOURCE_PHONE_NUMBER` | Required for real Connect calls. Values must match the claim. The source phone number uses E.164 format.          |

SNS SMS uses the E.164 destination issued by the backend. Connect provides the
backend message as the `message` contact attribute and uses the notification ID
as the Connect client token. Configure the contact flow to consume that attribute.

The SNS and Connect clients use one SDK attempt. A request that might have
reached the provider without a confirmed response produces an `UNCERTAIN`
outcome. If the process lost its result before persisting it, the backend claim
fence governs a subsequent job delivery. `PROVIDER_ACCEPTED` means the provider
accepted the request. Confirming delivery or acknowledgement is a separate action.

## Verify locally

Use a Python 3.12 virtual environment.

```sh
python -m pip install -r services/aws-workers/sender/requirements.txt coverage
python services/aws-workers/verify_sender.py
```

The gate requires both metrics to exceed 90% and writes the split counts to
`services/aws-workers/.build/sender-coverage.json`. The unit
tests stub the internal API and AWS clients.
