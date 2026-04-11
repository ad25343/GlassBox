"""
Multi-turn agent loop for the customer support agent.
Uses Claude Sonnet with Anthropic tool_use — up to MAX_TOOL_CALLS_PER_TURN per turn.

Returns (response_text, tool_call_trace, input_tokens, output_tokens).
The tool_call_trace is a list of dicts recording every tool invoked during the turn.
"""
from __future__ import annotations

import json
from typing import Any, Callable

import anthropic

from backend.core.config import Settings
from backend.core.logging import get_logger
from backend.services.tools import TOOL_DEFINITIONS, execute_tool

logger = get_logger(__name__)

MAX_TOOL_CALLS_PER_TURN = 5


class AgentService:
    def __init__(self, config: Settings) -> None:
        self._config = config
        self._client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)

    async def run_turn(
        self,
        *,
        model: str,
        system_prompt: str,
        customer_message: str,
        conversation_history: list[dict[str, Any]] | None = None,
        tool_executor: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
    ) -> tuple[str, list[dict[str, Any]], int, int]:
        """
        Run one complete agent turn: customer message → tools → response.

        The loop continues calling tools until the model reaches end_turn or
        MAX_TOOL_CALLS_PER_TURN is hit. After the cap, a final no-tool call
        forces a text response.

        Returns:
            response_text   — final assistant response to deliver to the customer
            tool_calls      — [{name, input, result, tool_use_id}, ...] for every tool invoked
            input_tokens    — total input tokens across all API calls this turn
            output_tokens   — total output tokens across all API calls this turn
        """
        # Build messages: history + current user message
        messages: list[dict[str, Any]] = list(conversation_history or [])
        messages.append({"role": "user", "content": customer_message})

        tool_calls: list[dict[str, Any]] = []
        input_tokens = 0
        output_tokens = 0
        tool_call_count = 0

        log = logger.bind(model=model)

        while True:
            response = await self._client.messages.create(
                model=model,
                max_tokens=1024,
                system=system_prompt,
                tools=TOOL_DEFINITIONS,  # type: ignore[arg-type]
                messages=messages,
            )
            input_tokens += response.usage.input_tokens
            output_tokens += response.usage.output_tokens

            log.debug(
                "agent step",
                stop_reason=response.stop_reason,
                tool_calls_so_far=tool_call_count,
                content_blocks=len(response.content),
            )

            # ── End turn: model produced a text response ──────────────────────
            if response.stop_reason == "end_turn":
                text = next(
                    (b.text for b in response.content if hasattr(b, "text")), ""
                )
                log.info(
                    "agent turn complete",
                    tool_call_count=tool_call_count,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                )
                return text, tool_calls, input_tokens, output_tokens

            # ── Tool use: model wants to call one or more tools ───────────────
            if response.stop_reason == "tool_use":
                # Append the full assistant content (may include text + tool_use blocks)
                messages.append(
                    {
                        "role": "assistant",
                        "content": [b.model_dump() for b in response.content],
                    }
                )

                tool_results: list[dict[str, Any]] = []
                for block in response.content:
                    if block.type != "tool_use":
                        continue

                    tool_call_count += 1
                    _exec = tool_executor if tool_executor is not None else execute_tool
                    result = _exec(block.name, block.input)

                    tool_calls.append(
                        {
                            "name": block.name,
                            "input": block.input,
                            "result": result,
                            "tool_use_id": block.id,
                        }
                    )
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": json.dumps(result),
                        }
                    )
                    log.debug(
                        "tool executed",
                        tool_name=block.name,
                        tool_call_count=tool_call_count,
                    )

                    if tool_call_count >= MAX_TOOL_CALLS_PER_TURN:
                        log.warning(
                            "max tool calls per turn reached",
                            cap=MAX_TOOL_CALLS_PER_TURN,
                        )
                        break

                messages.append({"role": "user", "content": tool_results})

                # Hit the cap — exit loop and force a final text response below
                if tool_call_count >= MAX_TOOL_CALLS_PER_TURN:
                    break

            else:
                # Unexpected stop reason (max_tokens, stop_sequence, etc.)
                log.warning("unexpected stop reason", stop_reason=response.stop_reason)
                text = next(
                    (b.text for b in response.content if hasattr(b, "text")), ""
                )
                return text, tool_calls, input_tokens, output_tokens

        # ── Final call without tools (after cap or forced exit) ───────────────
        final = await self._client.messages.create(
            model=model,
            max_tokens=1024,
            system=system_prompt,
            messages=messages,
            # No tools parameter → model must respond with text
        )
        input_tokens += final.usage.input_tokens
        output_tokens += final.usage.output_tokens
        text = next((b.text for b in final.content if hasattr(b, "text")), "")
        log.info(
            "agent turn complete (cap hit)",
            tool_call_count=tool_call_count,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        return text, tool_calls, input_tokens, output_tokens
