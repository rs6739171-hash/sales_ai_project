"""Local Ollama through LangChain, shared by forecast explanations and chat.

Uses the native Ollama API, with thinking disabled and a modest context window
for a 16 GB RAM / 4 GB VRAM development laptop. No LLM API key is required.
"""

import json
import logging
import os
import random
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv
from langchain_core.exceptions import OutputParserException
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage, convert_to_messages
from langchain_ollama import ChatOllama
from ollama import ResponseError
from openai.types.chat import ChatCompletionMessage
from pydantic import ValidationError

load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
logger = logging.getLogger("sales_forecasting_api.llm")


# JSON mode alone permits any object. These schemas constrain the actual
# decoder to the exact response fields used by each existing application flow.
GREETING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"message": {"type": "string"}},
    "required": ["message"],
    "additionalProperties": False,
}
CHAT_ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
    "additionalProperties": False,
}
FORECAST_EXPLANATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "explanation": {"type": "string"},
        "key_drivers": {"type": "array", "items": {"type": "string"}},
        "risks_or_opportunities": {"type": "array", "items": {"type": "string"}},
        "recommendation": {"type": "string"},
    },
    "required": ["explanation", "key_drivers", "risks_or_opportunities", "recommendation"],
    "additionalProperties": False,
}


class LLMConfigError(RuntimeError):
    """Missing model, invalid endpoint or invalid local configuration."""


class LLMServiceError(RuntimeError):
    """Safe diagnostic that the API may return to its caller."""

    def __init__(self, message: str, status_code: int = 503):
        super().__init__(message)
        self.status_code = status_code


class LLMResponseError(LLMServiceError):
    """Incomplete, malformed or empty model output."""

    def __init__(self, message: str):
        super().__init__(message, status_code=502)


class _LocalChatOllama(ChatOllama):
    """Preserve native tool_name with langchain-ollama 1.1.0 / ollama 0.6.3.

    LangChain tracks calls by ID internally, while this Ollama SDK serializes
    native tool results using tool_name and order. The upstream adapter omits
    tool_name, so add it before the SDK serializes each message.
    """

    def _convert_messages_to_ollama_messages(self, messages: list[BaseMessage]) -> list[dict]:
        converted = super()._convert_messages_to_ollama_messages(messages)
        names_by_id = {
            call["id"]: call["name"]
            for message in messages if isinstance(message, AIMessage)
            for call in message.tool_calls
        }
        for source, target in zip(messages, converted, strict=True):
            if isinstance(source, ToolMessage):
                name = source.name or names_by_id.get(source.tool_call_id)
                if name:
                    target["tool_name"] = name
        return converted


@dataclass(frozen=True)
class LLMSettings:
    base_url: str
    model: str
    num_ctx: int
    num_predict: int
    timeout: int
    max_retries: int


def _settings() -> LLMSettings:
    base_url = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").strip().rstrip("/")
    try:
        parsed = urlsplit(base_url)
        valid = (
            parsed.scheme in {"http", "https"} and parsed.hostname
            and not parsed.username and not parsed.password
            and not parsed.query and not parsed.fragment and not parsed.path
        )
        _ = parsed.port
    except ValueError:
        valid = False
    if not valid:
        raise LLMConfigError(
            "OLLAMA_BASE_URL must be an HTTP(S) server URL, for example http://127.0.0.1:11434."
        )
    model = os.getenv("OLLAMA_MODEL", "qwen3:4b").strip()
    if not model:
        raise LLMConfigError("Set OLLAMA_MODEL to the exact model tag shown by ollama list.")
    values = []
    for name, default, minimum, maximum in (
        ("OLLAMA_NUM_CTX", "4096", 2048, 32768),
        ("OLLAMA_NUM_PREDICT", "1024", 64, 8192),
        ("OLLAMA_TIMEOUT_SECONDS", "180", 5, 600),
        ("OLLAMA_MAX_RETRIES", "0", 0, 2),
    ):
        try:
            value = int(os.getenv(name, default))
            if not minimum <= value <= maximum:
                raise ValueError
        except ValueError as exc:
            raise LLMConfigError(
                f"{name} must be an integer between {minimum} and {maximum}."
            ) from exc
        values.append(value)
    if values[1] >= values[0]:
        raise LLMConfigError("OLLAMA_NUM_PREDICT must be smaller than OLLAMA_NUM_CTX.")
    return LLMSettings(base_url, model, *values)


@lru_cache(maxsize=8)
def get_client(timeout_seconds: Optional[int] = None) -> ChatOllama:
    settings = _settings()
    timeout = min(settings.timeout, timeout_seconds) if timeout_seconds is not None else settings.timeout
    return _LocalChatOllama(
        base_url=settings.base_url,
        model=settings.model,
        temperature=0,
        reasoning=False,
        num_ctx=settings.num_ctx,
        num_predict=settings.num_predict,
        keep_alive="5m",
        client_kwargs={"timeout": httpx.Timeout(timeout, connect=min(5.0, timeout))},
    )


def _server_error(status: int) -> RuntimeError:
    if status == 404:
        return LLMConfigError(
            "Ollama model or API path was not found. Check OLLAMA_BASE_URL and run "
            "ollama pull with the exact OLLAMA_MODEL tag on the Ollama server."
        )
    if status in {401, 403}:
        return LLMConfigError("Access to the configured Ollama endpoint was denied.")
    if status in {400, 422}:
        return LLMServiceError(
            "Ollama rejected the model request. Check its server logs and confirm "
            "the model supports tools and disabling thinking; qwen3:4b is the configured default.",
            status_code=502,
        )
    if status == 429:
        return LLMServiceError("The Ollama server is busy. Wait before retrying.", status_code=429)
    return LLMServiceError(
        "Ollama could not complete the request. Check its server logs for "
        "model-loading, memory or runtime errors."
    )


def _call_chat_native(
    messages: list[BaseMessage | dict[str, Any]],
    tools: Optional[list[dict[str, Any]]] = None,
    json_mode: bool = False,
    response_schema: Optional[dict[str, Any]] = None,
    max_output_tokens: Optional[int] = None,
    deadline: Optional[float] = None,
) -> AIMessage:
    """Return native LangChain tool calls or a final text/JSON response.

    Run tool selection and final JSON narration separately. No API key or
    external provider is needed when OLLAMA_BASE_URL points to your local server.
    """
    settings = _settings()
    if not messages:
        raise ValueError("messages must not be empty.")
    if tools and json_mode:
        raise ValueError("Use separate requests for tool selection and final JSON.")
    if response_schema is not None and not json_mode:
        raise ValueError("response_schema requires json_mode=True.")
    if max_output_tokens is not None and max_output_tokens < 1:
        raise ValueError("max_output_tokens must be positive.")
    # Chat calls share a deadline across tool selection and narration. A
    # bounded chat call must not start automatic retries after its time is up.
    timeout_seconds = None
    if deadline is not None:
        remaining = deadline - time.monotonic()
        if remaining < 1:
            raise LLMServiceError("The chat inference time budget was exhausted. Please try again.")
        timeout_seconds = max(1, min(settings.timeout, int(remaining)))
    retry_limit = 0 if deadline is not None else settings.max_retries
    # Legacy assistant tool-call dumps may omit content when it is None.
    normalized = [
        {**message, "content": message.get("content") or ""}
        if isinstance(message, dict) else message
        for message in messages
    ]
    request_messages = convert_to_messages(normalized)
    # Qwen3 also understands the documented prompt-level non-thinking switch.
    # Do not alter stored conversation history or replayed tool messages.
    if settings.model.lower().startswith("qwen3"):
        instruction = "Give the final answer directly. Do not include your analysis. /no_think"
        if isinstance(request_messages[0], SystemMessage):
            original = request_messages[0]
            request_messages[0] = SystemMessage(content=f"{original.content}\n\n{instruction}")
        else:
            request_messages.insert(0, SystemMessage(content=instruction))
    model = get_client(timeout_seconds) if timeout_seconds is not None else get_client()
    runnable = model.bind_tools(tools) if tools else model
    # Return complete responses to FastAPI; do not expose reasoning or partial JSON.
    runnable = runnable.bind(stream=False, reasoning=False)
    if max_output_tokens is not None:
        runnable = runnable.bind(options={
            "num_ctx": settings.num_ctx,
            "num_predict": min(settings.num_predict, max_output_tokens),
            "temperature": 0,
        })
    if json_mode:
        instruction = (
            "Return only the requested JSON object. Use the exact field names and "
            "types from the response schema. Do not add wrapper objects or markdown. "
            "Use supplied context as evidence when present."
        )
        if response_schema is not None:
            instruction += "\nResponse JSON schema: " + json.dumps(response_schema)
        if isinstance(request_messages[0], SystemMessage):
            original = request_messages[0]
            request_messages[0] = SystemMessage(content=f"{original.content}\n\n{instruction}")
        else:
            request_messages.insert(0, SystemMessage(content=instruction))
        runnable = runnable.bind(format=response_schema if response_schema is not None else "json")

    started = time.monotonic()
    for attempt in range(retry_limit + 1):
        try:
            response = runnable.invoke(request_messages)
            break
        except ResponseError as exc:
            status = exc.status_code or 500
            transient = status in {408, 429} or 500 <= status < 600
            if not transient or attempt == retry_limit:
                logger.error("Ollama request failed: server status %s", status)
                raise _server_error(status) from exc
        except httpx.TimeoutException as exc:
            if attempt == retry_limit:
                raise LLMServiceError(
                    "Ollama did not finish within the inference time budget. "
                    "The server may be busy or inference may be too slow for the available compute."
                ) from exc
        except (ConnectionError, httpx.RequestError) as exc:
            if attempt == retry_limit:
                raise LLMServiceError(
                    "Cannot connect to Ollama. Start the Ollama application and "
                    "check OLLAMA_BASE_URL. The default port is 11434."
                ) from exc
        except OutputParserException as exc:
            raise LLMResponseError("Ollama returned malformed tool arguments. Please retry.") from exc
        except ValidationError as exc:
            raise LLMResponseError("Ollama returned a malformed response or tool arguments. Please retry.") from exc
        delay = 2 ** attempt + random.uniform(0, 0.5)
        logger.warning("Retrying Ollama in %.1fs (%d/%d)", delay, attempt + 1, retry_limit)
        time.sleep(delay)

    if not isinstance(response, AIMessage):
        raise LLMResponseError("Ollama returned an unexpected message type.")
    logger.info(
        "Ollama completed: elapsed=%.1fs tools_enabled=%s json_mode=%s "
        "prompt_tokens=%s output_tokens=%s done_reason=%s",
        time.monotonic() - started, bool(tools), json_mode,
        response.response_metadata.get("prompt_eval_count"),
        response.response_metadata.get("eval_count"),
        response.response_metadata.get("done_reason"),
    )
    if response.invalid_tool_calls:
        raise LLMResponseError("Ollama returned malformed tool arguments. Please retry.")
    reason = response.response_metadata.get("done_reason")
    if reason not in {None, "stop", "tool_calls"}:
        hint = (
            "Try a shorter question; the model exceeded this chat phase's output budget."
            if max_output_tokens is not None else
            "For length errors, increase OLLAMA_NUM_PREDICT within the context budget."
        )
        raise LLMResponseError(
            f"Ollama response stopped before completion ({reason}). {hint}"
        )
    if not response.text and not response.tool_calls:
        raise LLMResponseError("Ollama returned no text or tool calls.")
    return response



def call_chat(
    messages: list[dict[str, Any]],
    tools: Optional[list[dict[str, Any]]] = None,
    json_mode: bool = False,
) -> ChatCompletionMessage:
    """Preserve the response interface expected by the unchanged chatbot.

    OpenAI is used only for its existing response data classes. Inference is
    performed by ChatOllama through the native /api/chat endpoint; no OpenAI,
    Azure, Gemini or Mistral API key or remote client is used.
    """
    response = _call_chat_native(
        messages, tools=tools, json_mode=json_mode,
        response_schema=CHAT_ANSWER_SCHEMA if json_mode else None,
    )
    calls = [
        {
            "id": call["id"],
            "type": "function",
            "function": {
                "name": call["name"],
                "arguments": json.dumps(call["args"], ensure_ascii=False),
            },
        }
        for call in response.tool_calls
    ]
    return ChatCompletionMessage(
        role="assistant",
        content=response.text,
        tool_calls=calls or None,
    )


def call_chat_json(
    system_prompt: str,
    user_message: str,
    *,
    response_schema: Optional[dict[str, Any]] = None,
) -> str:
    """Return forecast JSON by default; other callers may supply their schema.

    The existing forecast explainer keeps its two-argument call unchanged.
    The manual greeting test supplies GREETING_SCHEMA explicitly.
    """
    response = _call_chat_native(
        [{"role": "system", "content": system_prompt},
         {"role": "user", "content": user_message}],
        json_mode=True,
        response_schema=FORECAST_EXPLANATION_SCHEMA if response_schema is None else response_schema,
    )
    return response.text


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Test local Ollama through LangChain.")
    parser.add_argument("--name", default="World")
    args = parser.parse_args()
    reply = call_chat_json(
        'Respond with JSON in this shape: {"message": "..."}.',
        f"Say hello to {args.name} in one short sentence.",
        response_schema=GREETING_SCHEMA,
    )
    parsed = json.loads(reply)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("message"), str):
        raise LLMResponseError("Ollama did not return the expected greeting JSON.")
    print(json.dumps(parsed, indent=2, ensure_ascii=False))

