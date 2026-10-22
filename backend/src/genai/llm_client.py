"""Gemini Developer API client for forecast explanations and analytics chat.

Uses Google's OpenAI-compatible endpoint. The OpenAI package is only the
client library; requests and credentials go to Google, not to OpenAI.
"""

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from openai import AuthenticationError, OpenAI
from openai.types.chat import ChatCompletionMessage

load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


class LLMConfigError(RuntimeError):
    """Missing or invalid Gemini configuration or API credentials."""


class LLMResponseError(RuntimeError):
    """Gemini returned an incomplete, blocked, or empty response."""


def _settings() -> tuple[str, str, int]:
    """Validate configuration and return only non-secret settings."""
    key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()
    if not key or key in {"your_gemini_api_key", "paste_your_key_here"}:
        raise LLMConfigError("Set GEMINI_API_KEY in backend/.env.")
    if not model:
        raise LLMConfigError("Set GEMINI_MODEL to a model available to your project.")
    try:
        max_tokens = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "4096"))
        if max_tokens <= 0:
            raise ValueError
    except ValueError as exc:
        raise LLMConfigError(
            "GEMINI_MAX_OUTPUT_TOKENS must be a positive integer."
        ) from exc
    return GEMINI_BASE_URL, model, max_tokens


@lru_cache(maxsize=1)
def get_client() -> OpenAI:
    _settings()
    key = os.environ["GEMINI_API_KEY"].strip()
    return OpenAI(
        api_key=key,
        base_url=GEMINI_BASE_URL,
        timeout=45.0,
        max_retries=1,
    )


def call_chat(
    messages: list[dict[str, Any]],
    tools: Optional[list[dict[str, Any]]] = None,
    json_mode: bool = False,
) -> ChatCompletionMessage:
    """Return the chat message interface used by the existing application.

    Tool selection and final JSON generation run in separate requests.
    Keep complete assistant messages in tool history, including Gemini's
    provider metadata and any thought signatures.
    """
    _, model, max_tokens = _settings()
    if not messages:
        raise ValueError("messages must not be empty.")
    if json_mode and tools:
        raise ValueError("Use separate requests for tool selection and final JSON.")

    request_messages = list(messages)
    request: dict[str, Any] = {
        "model": model,
        "messages": request_messages,
        "max_completion_tokens": max_tokens,
    }
    if model.startswith("gemini-3"):
        request["reasoning_effort"] = "low"
    if tools:
        request["tools"] = tools
        request["tool_choice"] = "auto"
    if json_mode:
        request_messages = [
            {
                "role": "system",
                "content": (
                    "Return exactly one valid JSON object matching the requested "
                    "shape. Return no markdown fences or text outside the JSON. "
                    "Use only the supplied facts and tool results."
                ),
            },
            *messages,
        ]
        request["messages"] = request_messages
        request["response_format"] = {"type": "json_object"}

    try:
        response = get_client().chat.completions.create(**request)
    except AuthenticationError as exc:
        raise LLMConfigError(
            "Gemini rejected the API key. Check GEMINI_API_KEY and its project."
        ) from exc

    if not response.choices:
        raise LLMResponseError("Gemini returned no response choices.")
    choice = response.choices[0]
    if choice.finish_reason not in {"stop", "tool_calls"}:
        raise LLMResponseError(
            f"Gemini response stopped before completion: {choice.finish_reason}"
        )
    message = choice.message
    if not message.content and not message.tool_calls:
        raise LLMResponseError("Gemini returned no text or tool calls.")
    return message


def call_chat_json(system_prompt: str, user_message: str) -> str:
    """Return JSON text; the existing forecast parser validates its schema."""
    response = call_chat(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        json_mode=True,
    )
    return response.content or ""


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Test Gemini API connectivity.")
    parser.add_argument("--name", default="World")
    args = parser.parse_args()
    reply = call_chat_json(
        'Respond with JSON in this shape: {"message": "..."}.',
        f"Say hello to {args.name} in one short sentence.",
    )
    parsed = json.loads(reply)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("message"), str):
        raise LLMResponseError("Gemini did not return the expected greeting JSON.")
    print(json.dumps(parsed, indent=2, ensure_ascii=False))
