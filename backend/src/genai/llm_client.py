"""Amazon Bedrock client for forecast explanations and analytics chat.

Text-only compatibility adapter for this project's existing chat interface.
JSON mode prompts for JSON; callers still validate the returned content.
"""

import json
import os
import re
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import boto3
from botocore.config import Config
from botocore.exceptions import NoCredentialsError, PartialCredentialsError
from dotenv import load_dotenv

# backend/src/genai/llm_client.py -> backend/.env
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


class LLMConfigError(RuntimeError):
    """Missing AWS credentials or Bedrock configuration."""


class LLMResponseError(RuntimeError):
    """Bedrock returned an incomplete, blocked, or unsupported response."""


# Preserve the interface used by the existing chatbot.
@dataclass
class ToolFunction:
    name: str
    arguments: str


@dataclass
class ToolCall:
    id: str
    function: ToolFunction
    type: str = "function"


@dataclass
class ChatMessage:
    content: Optional[str]
    tool_calls: Optional[list[ToolCall]] = None
    role: str = "assistant"

    def model_dump(self, exclude_none: bool = False) -> dict[str, Any]:
        data = asdict(self)

        if exclude_none:
            data = {
                key: value
                for key, value in data.items()
                if value is not None
            }

        return data


def _settings() -> tuple[str, str, int]:
    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION")
    model_id = os.getenv("BEDROCK_MODEL_ID")

    if not region or not model_id:
        raise LLMConfigError(
            "Set AWS_DEFAULT_REGION (or AWS_REGION) and BEDROCK_MODEL_ID."
        )

    try:
        max_tokens = int(os.getenv("BEDROCK_MAX_TOKENS", "2048"))

        if max_tokens < 1:
            raise ValueError

    except ValueError as exc:
        raise LLMConfigError(
            "BEDROCK_MAX_TOKENS must be a positive integer."
        ) from exc

    return region, model_id, max_tokens


@lru_cache(maxsize=4)
def _client_for_region(region: str) -> Any:
    # Uses local AWS credentials during development.
    # On ECS, it automatically uses the application's IAM task role.
    return boto3.client(
        "bedrock-runtime",
        region_name=region,
        config=Config(
            connect_timeout=5,
            read_timeout=60,
            retries={
                "mode": "standard",
                "total_max_attempts": 3,
            },
        ),
    )


def get_client() -> Any:
    region, _, _ = _settings()
    return _client_for_region(region)


def _convert_messages(
    messages: list[dict[str, Any]],
) -> tuple[list, list]:
    """Convert existing chat messages into Bedrock Converse messages."""

    system: list[dict[str, str]] = []
    converted: list[dict[str, Any]] = []

    for message in messages:
        role = message["role"]
        text = message.get("content")

        if text is not None and not isinstance(text, str):
            raise ValueError(
                "This adapter supports string message content only."
            )

        if role == "system":
            if text:
                system.append({"text": text})
            continue

        blocks: list[dict[str, Any]] = []

        if role == "tool":
            # Bedrock receives tool results inside user messages.
            role = "user"

            blocks.append({
                "toolResult": {
                    "toolUseId": message["tool_call_id"],
                    "content": [{"text": text or "{}"}],
                }
            })

        elif role in {"user", "assistant"}:
            if text:
                blocks.append({"text": text})

            for call in message.get("tool_calls") or []:
                arguments = json.loads(
                    call["function"].get("arguments") or "{}"
                )

                if not isinstance(arguments, dict):
                    raise ValueError(
                        "Tool arguments must be a JSON object."
                    )

                blocks.append({
                    "toolUse": {
                        "toolUseId": call["id"],
                        "name": call["function"]["name"],
                        "input": arguments,
                    }
                })

        else:
            raise ValueError(f"Unsupported message role: {role}")

        if blocks:
            # Group consecutive messages of the same role.
            # In particular, multiple tool results belong together.
            if converted and converted[-1]["role"] == role:
                converted[-1]["content"].extend(blocks)
            else:
                converted.append({
                    "role": role,
                    "content": blocks,
                })

    if not converted or converted[0]["role"] != "user":
        raise ValueError(
            "Conversation must begin with a user message."
        )

    return system, converted


def call_chat(
    messages: list[dict[str, Any]],
    tools: Optional[list[dict[str, Any]]] = None,
    json_mode: bool = False,
) -> ChatMessage:
    """Call Bedrock while preserving this project's chat interface."""

    _, model_id, max_tokens = _settings()
    system, conversation = _convert_messages(messages)

    if json_mode:
        system.append({
            "text": (
                "Return exactly one valid JSON object matching the "
                "requested shape. Do not include markdown fences or "
                "text outside the JSON. Use the information already "
                "provided; do not request more tools."
            )
        })

    request: dict[str, Any] = {
        "modelId": model_id,
        "messages": conversation,
        "inferenceConfig": {
            "maxTokens": max_tokens,
        },
    }

    if system:
        request["system"] = system

    if tools:
        definitions = []

        for tool in tools:
            if tool.get("type") != "function":
                raise ValueError(
                    "Only function tools are supported."
                )

            function = tool["function"]

            spec = {
                "name": function["name"],
                "inputSchema": {
                    "json": function.get(
                        "parameters",
                        {
                            "type": "object",
                            "properties": {},
                        },
                    )
                },
            }

            if function.get("description"):
                spec["description"] = function["description"]

            definitions.append({"toolSpec": spec})

        request["toolConfig"] = {
            "tools": definitions,
        }

    try:
        response = get_client().converse(**request)

    except (NoCredentialsError, PartialCredentialsError) as exc:
        raise LLMConfigError(
            "AWS credentials are missing or incomplete. Configure "
            "local credentials, or attach an IAM task role when "
            "running on ECS."
        ) from exc

    # Do not treat truncated or blocked output as a successful answer.
    stop_reason = response.get("stopReason")

    if stop_reason not in {
        "end_turn",
        "tool_use",
        "stop_sequence",
    }:
        raise LLMResponseError(
            f"Bedrock response stopped: {stop_reason}"
        )

    text_parts = []
    calls = []

    for block in response["output"]["message"]["content"]:
        if "text" in block:
            text_parts.append(block["text"])

        elif "toolUse" in block:
            use = block["toolUse"]

            if not isinstance(use["input"], dict):
                raise LLMResponseError(
                    "Bedrock returned non-object tool arguments."
                )

            calls.append(
                ToolCall(
                    id=use["toolUseId"],
                    function=ToolFunction(
                        name=use["name"],
                        arguments=json.dumps(
                            use["input"],
                            ensure_ascii=False,
                        ),
                    ),
                )
            )

    content = "\n".join(text_parts).strip() or None

    # Tolerate an enclosing JSON markdown fence.
    # The existing forecast/chat parsers still validate the JSON.
    if json_mode and content:
        fenced = re.fullmatch(
            r"```(?:json)?\s*(.*?)\s*```",
            content,
            flags=re.S,
        )

        if fenced:
            content = fenced.group(1).strip()

    return ChatMessage(
        content=content,
        tool_calls=calls or None,
    )


def call_chat_json(
    system_prompt: str,
    user_message: str,
) -> str:
    """Return response text for the existing forecast JSON validator."""

    message = call_chat(
        [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": user_message,
            },
        ],
        json_mode=True,
    )

    return message.content or ""


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Test Amazon Bedrock connectivity."
    )
    parser.add_argument("--name", default="World")
    args = parser.parse_args()

    reply = call_chat_json(
        'Respond with JSON in this shape: {"message": "..."}.',
        f"Say hello to {args.name} in one short sentence.",
    )

    parsed = json.loads(reply)

    if (
        not isinstance(parsed, dict)
        or not isinstance(parsed.get("message"), str)
    ):
        raise LLMResponseError(
            "Smoke test did not return the expected JSON shape."
        )

    print(json.dumps(parsed, ensure_ascii=False, indent=2))