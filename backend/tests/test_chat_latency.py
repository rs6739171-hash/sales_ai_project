"""Regression coverage for redundant inference and safe timeout behavior."""

import time
from unittest.mock import Mock

import httpx
import pytest
from langchain_core.messages import AIMessage, ToolMessage

from src.genai import chatbot, llm_client


@pytest.mark.parametrize("greeting", ["HI", "Hello!", "good morning", "Namaste"])
def test_greeting_uses_one_structured_call_without_analytics(monkeypatch, greeting):
    llm = Mock(return_value=AIMessage(content='{"answer":"Hello! How can I help?"}'))
    monkeypatch.setattr(chatbot, "call_chat", llm)
    result = chatbot.run_chat(greeting, store_id="S01")
    assert result == {"answer": "Hello! How can I help?", "data": {}, "functions_used": []}
    llm.assert_called_once()
    kwargs = llm.call_args.kwargs
    assert not kwargs.get("tools")
    assert kwargs["response_schema"] == llm_client.CHAT_ANSWER_SCHEMA
    assert kwargs["max_output_tokens"] == 96
    assert "analytics tools" not in str(llm.call_args.args[0])


def test_greeting_prefix_does_not_bypass_sales_tools(monkeypatch):
    llm = Mock(return_value=AIMessage(content='{"answer":"No records found."}'))
    monkeypatch.setattr(chatbot, "call_chat", llm)
    chatbot.run_chat("Hi, what is our top product?")
    assert llm.call_args.kwargs["tools"] == chatbot.TOOLS


def test_invalid_greeting_is_not_a_hardcoded_success(monkeypatch):
    llm = Mock(return_value=AIMessage(content="not valid JSON"))
    monkeypatch.setattr(chatbot, "call_chat", llm)
    with pytest.raises(llm_client.LLMResponseError):
        chatbot.run_chat("Hi")
    llm.assert_called_once()


def test_tool_narration_timeout_preserves_real_data(monkeypatch):
    selected = AIMessage(content="", tool_calls=[
        {"id": "call-1", "name": "get_top_product", "args": {"store_id": "S01"}}
    ])
    real_result = {"product_name": "Verified product", "total_units": 42}
    handler = Mock(return_value=real_result)
    monkeypatch.setitem(chatbot.TOOL_DISPATCH, "get_top_product", handler)
    llm = Mock(side_effect=[selected, llm_client.LLMServiceError("Timed out")])
    monkeypatch.setattr(chatbot, "call_chat", llm)
    result = chatbot.run_chat("What is our top product?")
    assert result["data"] == {"get_top_product": real_result}
    assert result["functions_used"] == ["get_top_product"]
    assert "Verified product" in result["answer"] and "42" in result["answer"]
    assert llm.call_count == 2
    assert llm.call_args_list[0].kwargs["deadline"] == llm.call_args_list[1].kwargs["deadline"]
    assert any(isinstance(m, ToolMessage) for m in llm.call_args_list[1].args[0])


def test_native_request_has_real_output_and_thinking_limits(monkeypatch):
    model = llm_client._LocalChatOllama(
        model="qwen3:4b", reasoning=False, num_ctx=4096, num_predict=2048,
    )
    seen = {}

    def fake_chat(**kwargs):
        seen.update(kwargs)
        from ollama import ChatResponse
        return ChatResponse(
            model="qwen3:4b", done=True, done_reason="stop", eval_count=12,
            message={"role": "assistant", "content": '{"answer":"Hello!"}'},
        )

    monkeypatch.setattr(model._client, "chat", fake_chat)
    monkeypatch.setattr(llm_client, "get_client", lambda *a: model)
    reply = llm_client._call_chat_native(
        [{"role": "system", "content": "Be helpful."}, {"role": "user", "content": "Hello"}],
        json_mode=True, response_schema=llm_client.CHAT_ANSWER_SCHEMA,
        max_output_tokens=96, deadline=time.monotonic() + 30,
    )
    assert reply.text == '{"answer":"Hello!"}'
    assert seen["stream"] is False and seen["think"] is False
    assert seen["options"]["num_predict"] == 96
    assert seen["options"]["num_ctx"] == 4096
    assert seen["format"] == llm_client.CHAT_ANSWER_SCHEMA
    assert "/no_think" in seen["messages"][0]["content"]


def test_expired_deadline_never_calls_ollama(monkeypatch):
    client = Mock(side_effect=AssertionError("Must not start another request"))
    monkeypatch.setattr(llm_client, "get_client", client)
    with pytest.raises(llm_client.LLMServiceError, match="time budget"):
        llm_client._call_chat_native(
            [{"role": "user", "content": "Hello"}], deadline=time.monotonic() - 1,
        )
    client.assert_not_called()


def test_bounded_chat_does_not_retry_a_timeout(monkeypatch):
    model = Mock()
    model.bind.return_value = model
    model.invoke.side_effect = httpx.ReadTimeout("slow server")
    monkeypatch.setattr(llm_client, "get_client", lambda *a: model)
    monkeypatch.setenv("OLLAMA_MAX_RETRIES", "2")
    with pytest.raises(llm_client.LLMServiceError, match="time budget"):
        llm_client._call_chat_native(
            [{"role": "user", "content": "Hello"}], deadline=time.monotonic() + 30,
        )
    model.invoke.assert_called_once()
