"""Tests for the multi-turn agent loop (backend/services/agent.py).

All Anthropic API calls are mocked — no real LLM calls are made.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.agent import AgentService, MAX_TOOL_CALLS_PER_TURN


def _make_text_response(text: str, input_tokens: int = 50, output_tokens: int = 100) -> MagicMock:
    """Build a mock messages.create response that ends the turn with text."""
    block = MagicMock()
    block.type = "text"
    block.text = text
    response = MagicMock()
    response.stop_reason = "end_turn"
    response.content = [block]
    response.usage.input_tokens = input_tokens
    response.usage.output_tokens = output_tokens
    return response


def _make_tool_use_response(
    tool_calls: list[dict[str, Any]],
    input_tokens: int = 50,
    output_tokens: int = 30,
) -> MagicMock:
    """Build a mock response that requests one or more tool calls."""
    blocks = []
    for tc in tool_calls:
        block = MagicMock()
        block.type = "tool_use"
        block.name = tc["name"]
        block.input = tc["input"]
        block.id = tc.get("id", f"tool_{tc['name']}")
        block.model_dump = lambda b=block: {
            "type": "tool_use",
            "name": b.name,
            "input": b.input,
            "id": b.id,
        }
        blocks.append(block)
    response = MagicMock()
    response.stop_reason = "tool_use"
    response.content = blocks
    response.usage.input_tokens = input_tokens
    response.usage.output_tokens = output_tokens
    return response


@pytest.fixture()
def agent(tmp_path):
    """AgentService with a mocked Anthropic client."""
    config = MagicMock()
    config.ANTHROPIC_API_KEY = "test-key"

    with patch("backend.services.agent.anthropic.AsyncAnthropic") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value = mock_client
        svc = AgentService(config)
        svc._client = mock_client
        yield svc, mock_client


# ── Happy paths ────────────────────────────────────────────────────────────────

class TestAgentSimpleEndTurn:
    async def test_returns_text_on_end_turn(self, agent):
        svc, mock_client = agent
        mock_client.messages.create = AsyncMock(
            return_value=_make_text_response("Hello! How can I help you today?")
        )

        text, calls, in_tok, out_tok = await svc.run_turn(
            model="claude-haiku-4-5",
            system_prompt="You are a support agent.",
            customer_message="Hi there.",
        )

        assert text == "Hello! How can I help you today?"
        assert calls == []
        assert in_tok == 50
        assert out_tok == 100

    async def test_token_counts_returned(self, agent):
        svc, mock_client = agent
        mock_client.messages.create = AsyncMock(
            return_value=_make_text_response("Response", input_tokens=120, output_tokens=80)
        )
        _, _, in_tok, out_tok = await svc.run_turn(
            model="claude-haiku-4-5",
            system_prompt="System",
            customer_message="Message",
        )
        assert in_tok == 120
        assert out_tok == 80


class TestAgentToolUse:
    async def test_single_tool_call_then_response(self, agent, tmp_db):
        svc, mock_client = agent

        tool_response = _make_tool_use_response([
            {"name": "lookup_customer", "input": {"last_name": "Chen", "order_id": "7823"}, "id": "tu_001"},
        ])
        final_response = _make_text_response("I found your order, Sarah!", input_tokens=80, output_tokens=60)

        mock_client.messages.create = AsyncMock(side_effect=[tool_response, final_response])

        text, calls, in_tok, out_tok = await svc.run_turn(
            model="claude-haiku-4-5",
            system_prompt="You are a support agent.",
            customer_message="I'm Sarah Chen, order 7823.",
        )

        assert text == "I found your order, Sarah!"
        assert len(calls) == 1
        assert calls[0]["name"] == "lookup_customer"
        assert calls[0]["input"] == {"last_name": "Chen", "order_id": "7823"}
        assert calls[0]["result"]["found"] is True
        assert calls[0]["tool_use_id"] == "tu_001"
        # Tokens accumulate across both API calls
        assert in_tok == 50 + 80
        assert out_tok == 30 + 60

    async def test_multiple_tool_calls_accumulate(self, agent, tmp_db):
        svc, mock_client = agent

        step1 = _make_tool_use_response([
            {"name": "lookup_customer", "input": {"last_name": "Rodriguez", "order_id": "4521"}, "id": "tu_001"},
        ])
        step2 = _make_tool_use_response([
            {"name": "check_return_eligibility", "input": {"order_id": "4521"}, "id": "tu_002"},
        ])
        step3 = _make_text_response("Your return is eligible!")

        mock_client.messages.create = AsyncMock(side_effect=[step1, step2, step3])

        text, calls, _, _ = await svc.run_turn(
            model="claude-haiku-4-5",
            system_prompt="System",
            customer_message="I want to return order 4521.",
        )

        assert text == "Your return is eligible!"
        assert len(calls) == 2
        assert calls[0]["name"] == "lookup_customer"
        assert calls[1]["name"] == "check_return_eligibility"

    async def test_tool_result_injected_into_messages(self, agent, tmp_db):
        """The tool result JSON should appear in the messages list sent to the next call."""
        svc, mock_client = agent

        captured_messages: list[Any] = []

        async def capture_create(**kwargs):
            captured_messages.append(kwargs.get("messages", []))
            if len(captured_messages) == 1:
                return _make_tool_use_response([
                    {"name": "get_order_details", "input": {"order_id": "4521"}, "id": "tu_x"},
                ])
            return _make_text_response("Got it.")

        mock_client.messages.create = capture_create

        await svc.run_turn(
            model="claude-haiku-4-5",
            system_prompt="System",
            customer_message="Check order 4521.",
        )

        # The second call should include a user message with tool_result content
        second_call_messages = captured_messages[1]
        tool_result_msg = second_call_messages[-1]
        assert tool_result_msg["role"] == "user"
        assert any(
            item.get("type") == "tool_result"
            for item in tool_result_msg["content"]
        )


class TestAgentToolCap:
    async def test_cap_forces_final_response(self, agent, tmp_db):
        """When MAX_TOOL_CALLS_PER_TURN is reached the loop breaks and forces a no-tool final call."""
        svc, mock_client = agent

        # Each step requests one tool call; repeat enough to hit the cap
        tool_steps = [
            _make_tool_use_response([
                {"name": "get_order_details", "input": {"order_id": "4521"}, "id": f"tu_{i}"},
            ])
            for i in range(MAX_TOOL_CALLS_PER_TURN)
        ]
        final = _make_text_response("Capped response.", input_tokens=40, output_tokens=20)
        mock_client.messages.create = AsyncMock(side_effect=tool_steps + [final])

        text, calls, _, _ = await svc.run_turn(
            model="claude-haiku-4-5",
            system_prompt="System",
            customer_message="Keep going.",
        )

        assert text == "Capped response."
        assert len(calls) == MAX_TOOL_CALLS_PER_TURN

    async def test_cap_value_is_five(self):
        assert MAX_TOOL_CALLS_PER_TURN == 5


class TestAgentConversationHistory:
    async def test_history_prepended_to_messages(self, agent):
        svc, mock_client = agent

        captured: list[Any] = []

        async def capture_create(**kwargs):
            captured.append(kwargs["messages"])
            return _make_text_response("Response")

        mock_client.messages.create = capture_create

        history = [
            {"role": "user", "content": "First message"},
            {"role": "assistant", "content": "First reply"},
        ]

        await svc.run_turn(
            model="claude-haiku-4-5",
            system_prompt="System",
            customer_message="Second message",
            conversation_history=history,
        )

        sent = captured[0]
        assert sent[0] == {"role": "user", "content": "First message"}
        assert sent[1] == {"role": "assistant", "content": "First reply"}
        assert sent[2] == {"role": "user", "content": "Second message"}

    async def test_no_history_single_message(self, agent):
        svc, mock_client = agent
        captured: list[Any] = []

        async def capture_create(**kwargs):
            captured.append(kwargs["messages"])
            return _make_text_response("Hi")

        mock_client.messages.create = capture_create

        await svc.run_turn(
            model="claude-haiku-4-5",
            system_prompt="System",
            customer_message="Hello",
        )

        assert captured[0] == [{"role": "user", "content": "Hello"}]


# ── Error paths ────────────────────────────────────────────────────────────────

class TestAgentErrorPaths:
    async def test_unknown_tool_returns_error_dict(self, agent, tmp_db):
        """If the model calls a tool that doesn't exist, execute_tool returns an error dict
        and the loop continues rather than raising."""
        svc, mock_client = agent

        step1 = _make_tool_use_response([
            {"name": "nonexistent_tool", "input": {}, "id": "tu_err"},
        ])
        final = _make_text_response("Done anyway.")
        mock_client.messages.create = AsyncMock(side_effect=[step1, final])

        text, calls, _, _ = await svc.run_turn(
            model="claude-haiku-4-5",
            system_prompt="System",
            customer_message="Hi.",
        )

        assert text == "Done anyway."
        assert calls[0]["result"].get("error") is not None

    async def test_unexpected_stop_reason_returns_text(self, agent):
        svc, mock_client = agent

        response = MagicMock()
        response.stop_reason = "max_tokens"
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = "Truncated response"
        response.content = [text_block]
        response.usage.input_tokens = 50
        response.usage.output_tokens = 1024

        mock_client.messages.create = AsyncMock(return_value=response)

        text, calls, _, _ = await svc.run_turn(
            model="claude-haiku-4-5",
            system_prompt="System",
            customer_message="Long question.",
        )

        assert text == "Truncated response"
        assert calls == []
