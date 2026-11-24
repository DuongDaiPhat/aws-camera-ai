"""Send only notifications authorized by the internal notification API."""

import json
import logging
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import uuid4

import boto3
from botocore.config import Config
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    NoCredentialsError,
    ParamValidationError,
    PartialCredentialsError,
)
from jsonschema import Draft202012Validator, FormatChecker

VALIDATOR = Draft202012Validator(
    json.loads(
        Path(__file__).with_name("queue-v1.schema.json").read_text(encoding="utf-8")
    ),
    format_checker=FormatChecker(),
)
LOGGER = logging.getLogger(__name__)
CLIENTS = {}
HTTP_TIMEOUT = 4
SDK_CONNECT_TIMEOUT = 2
SDK_READ_TIMEOUT = 4
SDK_BUDGET = SDK_CONNECT_TIMEOUT + SDK_READ_TIMEOUT
RESULT_BUDGET = HTTP_TIMEOUT + SDK_BUDGET
DELIVERY_BUDGET = SDK_BUDGET + RESULT_BUDGET
PHONE = re.compile(r"\+[1-9][0-9]{1,14}")
REGISTRATION_ID = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
)
DEFINITE_REJECTIONS = {
    "AccessDenied",
    "AccessDeniedException",
    "AuthorizationError",
    "EndpointDisabled",
    "InvalidParameter",
    "InvalidParameterException",
    "InvalidParameterValue",
    "InvalidRequestException",
    "InvalidSecurity",
    "KMSAccessDenied",
    "NotFound",
    "OutboundContactNotPermittedException",
    "ResourceNotFoundException",
    "UnsupportedOperationException",
    "ValidationException",
}


class BlockedProviderError(Exception):
    """A delivery or deployment setting prevents the send."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Backend redirects are not allowed")


BACKEND_OPENER = build_opener(NoRedirect)


def backend(path, *, method="GET", data=None):
    base = os.environ["INTERNAL_API_BASE_URL"].rstrip("/")
    origin = urlsplit(base)
    if (
        origin.scheme != "https"
        or not origin.hostname
        or origin.username is not None
        or origin.path != "/api/v1"
        or origin.query
        or origin.fragment
    ):
        raise ValueError("Expected HTTPS backend ending in /api/v1")
    token = os.environ["INTERNAL_SERVICE_TOKEN"]
    if len(token) < 32:
        raise ValueError("Internal token too short")
    request = Request(
        base + path,
        data=None if data is None else json.dumps(data).encode(),
        method=method,
        headers={"X-Internal-Token": token, "Content-Type": "application/json"},
    )
    with BACKEND_OPENER.open(request, timeout=HTTP_TIMEOUT) as response:
        return json.load(response)


def client(service):
    if service not in CLIENTS:
        CLIENTS[service] = boto3.client(
            service,
            region_name=os.environ["AWS_REGION"],
            config=Config(
                retries={"total_max_attempts": 1, "mode": "standard"},
                connect_timeout=SDK_CONNECT_TIMEOUT,
                read_timeout=SDK_READ_TIMEOUT,
            ),
        )
    return CLIENTS[service]


def personal_email_topic(topic):
    prefix = os.environ.get("SNS_EMAIL_TOPIC_PREFIX_ARN", "")
    match = re.fullmatch(
        r"arn:aws:sns:([a-z0-9-]+):[0-9]{12}:argusai-(dev|staging|production)-incident-email-user-",
        prefix,
    )
    return bool(
        match
        and match[1] == os.environ.get("AWS_REGION")
        and match[2] == os.environ.get("APP_ENV")
        and isinstance(topic, str)
        and topic.startswith(prefix)
        and REGISTRATION_ID.fullmatch(topic[len(prefix) :])
    )


def sole_confirmed_email(sns, topic, destination):
    if not isinstance(destination, str) or not destination:
        return False
    page = sns.list_subscriptions_by_topic(TopicArn=topic)
    subscriptions = page.get("Subscriptions", [])
    if page.get("NextToken") or len(subscriptions) != 1:
        return False
    subscription = subscriptions[0]
    return (
        subscription.get("TopicArn") == topic
        and subscription.get("Protocol") == "email"
        and subscription.get("Endpoint", "").lower() == destination.lower()
        and subscription.get("SubscriptionArn", "").startswith(topic + ":")
    )


def provider_request(delivery, notice_id):
    env = os.environ.get("APP_ENV")
    if env not in {"dev", "staging", "production"}:
        raise BlockedProviderError
    prefix = f"[ArgusAI][{env.upper()}]"
    channel = delivery["channel"]
    message = delivery.get("message")
    if not isinstance(message, str) or not message.startswith(prefix):
        raise BlockedProviderError

    if channel == "SNS_EMAIL":
        topic = delivery.get("topicArn")
        subject = delivery.get("subject")
        if not topic or (
            topic != os.environ.get("SNS_TOPIC_ARN") and not personal_email_topic(topic)
        ):
            raise BlockedProviderError
        fields = {"TopicArn": topic, "Message": message}
        if subject is not None:
            if (
                not isinstance(subject, str)
                or not subject.startswith(prefix)
                or len(subject) >= 100
                or any(ord(char) < 32 or ord(char) == 127 for char in subject)
            ):
                raise BlockedProviderError
            fields["Subject"] = subject
        return "sns", "publish", fields, "MessageId"

    destination = delivery.get("destination")
    if not isinstance(destination, str) or not PHONE.fullmatch(destination):
        raise BlockedProviderError
    if channel == "SNS_SMS":
        return (
            "sns",
            "publish",
            {"PhoneNumber": destination, "Message": message},
            "MessageId",
        )

    instance = os.environ.get("CONNECT_INSTANCE_ID")
    flow = os.environ.get("CONNECT_CONTACT_FLOW_ID")
    source = os.environ.get("CONNECT_SOURCE_PHONE_NUMBER")
    if (
        not instance
        or instance != delivery.get("instanceId")
        or not flow
        or flow != delivery.get("contactFlowId")
        or not source
        or source != delivery.get("sourcePhoneNumber")
        or not PHONE.fullmatch(source)
    ):
        raise BlockedProviderError
    fields = {
        "DestinationPhoneNumber": destination,
        "InstanceId": instance,
        "ContactFlowId": flow,
        "SourcePhoneNumber": source,
        "ClientToken": notice_id,
        "Attributes": {"message": message},
    }
    return "connect", "start_outbound_voice_contact", fields, "ContactId"


def has_budget(context, seconds):
    # Leave one extra second for response handling, validation, and serialization.
    return (
        context is None
        or context.get_remaining_time_in_millis() >= (seconds + 1) * 1000
    )


def require_budget(context, seconds):
    if not has_budget(context, seconds):
        raise TimeoutError("Insufficient Lambda time remaining")


def deliver(claim, job, context):
    if claim["mode"] == "DRY_RUN":
        reason = (
            "BLOCKED_PROVIDER"
            if claim.get("reason") == "BLOCKED_PROVIDER"
            else "LAB_DRY_RUN"
        )
        return "DRY_RUN", False, None, reason
    if claim["mode"] != "REAL":
        raise ValueError("Unknown claim mode")
    if os.environ.get("SENDER_DRY_RUN", "true").strip().lower() != "false":
        return "DRY_RUN", False, None, "SENDER_DRY_RUN"

    delivery = claim["delivery"]
    if delivery["channel"] != job["channel"] or not delivery.get("recipientRef"):
        raise ValueError("Claim delivery scope mismatch")
    lease = datetime.fromisoformat(claim["leaseUntil"])
    if lease.tzinfo is None:
        raise ValueError("Claim lease requires a timezone")
    if lease <= datetime.now(UTC):
        return "FAILED", False, None, "LEASE_EXPIRED"

    try:
        service, operation, fields, id_key = provider_request(
            delivery, job["notificationId"]
        )
        provider = client(service)
        topic = fields.get("TopicArn")
        if personal_email_topic(topic):
            if not has_budget(context, DELIVERY_BUDGET + SDK_BUDGET):
                return "FAILED", False, None, "LAMBDA_TIME_BUDGET"
            if not sole_confirmed_email(provider, topic, delivery.get("destination")):
                raise BlockedProviderError
        send = getattr(provider, operation)
    except (BlockedProviderError, BotoCoreError, ClientError, KeyError):
        return "FAILED", False, None, "BLOCKED_PROVIDER"
    # Client creation can take time, so check the lease again immediately before sending.
    if lease <= datetime.now(UTC):
        return "FAILED", False, None, "LEASE_EXPIRED"

    if not has_budget(context, DELIVERY_BUDGET):
        return "FAILED", False, None, "LAMBDA_TIME_BUDGET"

    return invoke_provider(send, fields, id_key)


def invoke_provider(send, fields, id_key):
    try:
        provider_id = send(**fields)[id_key]
        if isinstance(provider_id, str) and provider_id:
            return "PROVIDER_ACCEPTED", True, provider_id, None
    except (NoCredentialsError, PartialCredentialsError, ParamValidationError):
        return "FAILED", False, None, "BLOCKED_PROVIDER"
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in DEFINITE_REJECTIONS:
            return "FAILED", True, None, "BLOCKED_PROVIDER"
    except Exception:  # noqa: BLE001, S110 -- Fence all ambiguous sends without logging provider PII.
        # After invocation an unexpected error can conceal provider acceptance.
        pass
    return "UNCERTAIN", True, None, "PROVIDER_CALL_UNCERTAIN"


def make_outcome(claim, job, context):
    status, provider_called, provider_id, reason = deliver(claim, job, context)
    outcome_id = str(uuid4())
    return {
        "schemaVersion": 1,
        "type": "notification.outcome",
        "messageId": outcome_id,
        "correlationId": job["eventId"],
        "occurredAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "payload": {
            "outcomeId": outcome_id,
            "notificationId": job["notificationId"],
            "eventId": job["eventId"],
            "ownerScopeId": job["ownerScopeId"],
            "attemptId": claim["attemptId"],
            "status": status,
            "providerCalled": provider_called,
            "providerId": provider_id,
            "reason": reason,
        },
    }


def process(message, context):
    VALIDATOR.validate(message)
    if message["type"] != "notification.job":
        raise ValueError("Expected notification.job")
    job = message["payload"]
    notice_id = job["notificationId"]
    path = f"/internal/notifications/{notice_id}"
    require_budget(context, HTTP_TIMEOUT)
    persisted = backend(path)
    if (
        message != persisted["envelope"]
        or message["messageId"] != notice_id
        or message["correlationId"] != job["eventId"]
    ):
        raise ValueError("Job differs from authorized DB envelope")

    result = persisted["cached_result"]
    if result is None:
        require_budget(context, HTTP_TIMEOUT + DELIVERY_BUDGET)
        claim = backend(
            path + "/claim",
            method="POST",
            data={
                "schemaVersion": 1,
                "claimId": notice_id,
                "eventId": job["eventId"],
                "expectedEventVersion": job["expectedEventVersion"],
            },
        )
        if claim["notificationId"] != notice_id:
            raise ValueError("Claim scope mismatch")
        if claim["disposition"] == "NO_OP":
            return
        if claim["disposition"] != "CLAIMED":
            raise ValueError("Expected an authorized claim")
        attempt_id = claim["attemptId"]
        if not isinstance(attempt_id, str) or not VALIDATOR.format_checker.conforms(
            attempt_id, "uuid"
        ):
            raise ValueError("Invalid attempt ID")
        result = make_outcome(claim, job, context)
        VALIDATOR.validate(result)
        require_budget(context, HTTP_TIMEOUT)
        result = backend(path + "/result", method="PUT", data=result)

    VALIDATOR.validate(result)
    outcome = result["payload"]
    if (
        result["type"] != "notification.outcome"
        or result["messageId"] != outcome["outcomeId"]
        or result["correlationId"] != job["eventId"]
        or any(
            outcome[key] != job[key]
            for key in ("notificationId", "eventId", "ownerScopeId")
        )
    ):
        raise ValueError("Outcome scope mismatch")
    require_budget(context, SDK_BUDGET)
    client("sqs").send_message(
        QueueUrl=os.environ["APPLICATION_RESULTS_QUEUE_URL"],
        MessageBody=json.dumps(result),
    )


def lambda_handler(event, context):
    failures = []
    for record in event["Records"]:
        try:
            process(json.loads(record["body"]), context)
        except Exception:  # noqa: BLE001 -- The SQS boundary must retain every failed input for retry.
            LOGGER.warning("Sender input failed messageId=%s", record["messageId"])
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
