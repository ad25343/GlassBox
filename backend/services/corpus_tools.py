"""
Corpus-aware mock tools for the test suite.

Each tool mirrors the exact response format of its production counterpart
(tools.py) but sources data from the pre-loaded corpus context instead of
the DB. This lets the main model run its full tool-calling loop on corpus
examples without requiring test data in the production database.

Usage:
    executor = make_corpus_tool_executor(example["context"])
    # pass executor to AgentService.run_turn(tool_executor=executor)
"""
from __future__ import annotations

from typing import Any, Callable


def make_corpus_tool_executor(
    context: dict[str, Any],
) -> Callable[[str, dict[str, Any]], dict[str, Any]]:
    """Return a tool executor bound to a specific corpus example's context."""

    order_id = context.get("order_id", "ORD-00000")
    account_id = context.get("account_id", "CUS-00000")
    customer_name = context.get("customer_name", "Alex Customer")
    name_parts = customer_name.split(" ", 1)
    first_name = name_parts[0]
    last_name = name_parts[1] if len(name_parts) > 1 else "Customer"
    email = f"{first_name.lower()}.{last_name.lower()}@example.com"

    def _lookup_customer(last_name: str, order_id: str) -> dict[str, Any]:  # noqa: ARG001
        return {
            "found": True,
            "customer_id": account_id,
            "first_name": first_name,
            "last_name": last_name,
            "email": email,
            "order_id": order_id,
            "order_status": context.get("status", "active"),
            "item_description": context.get("product", context.get("issue_type", "product")),
            "ordered_at": context.get("purchase_date", "2026-03-01"),
            "shipped_at": None,
            "delivered_at": None,
            "carrier": context.get("carrier"),
            "tracking_number": context.get("tracking_number"),
        }

    def _get_order_details(order_id: str) -> dict[str, Any]:  # noqa: ARG001
        return {
            "found": True,
            "order_id": order_id,
            "customer_id": account_id,
            "status": context.get("status", "active"),
            "carrier": context.get("carrier"),
            "tracking_number": context.get("tracking_number"),
            "item_description": context.get("product", "product"),
            "total_amount": None,
            "ordered_at": context.get("purchase_date", "2026-03-01"),
            "shipped_at": None,
            "delivered_at": None,
            "last_scan_at": None,
            "last_scan_location": None,
            "estimated_delivery": context.get("estimated_delivery"),
            "items": [],
        }

    def _check_return_eligibility(order_id: str) -> dict[str, Any]:  # noqa: ARG001
        eligible = context.get("refund_eligible", True)
        days_since = context.get("days_since_purchase", 10)
        window = context.get("return_window_days", 30)
        days_remaining = window - days_since
        return {
            "found": True,
            "order_id": order_id,
            "eligible": eligible,
            "days_since_delivery": days_since,
            "days_remaining": max(0, days_remaining),
            "return_window_days": window,
            "reason": (
                f"Within return window — {days_remaining} days remaining."
                if eligible and days_remaining > 0
                else "Return window expired or order not eligible for return."
            ),
        }

    def _get_return_label(order_id: str) -> dict[str, Any]:
        numeric_id = abs(hash(order_id)) % 100000
        label_ref = f"RTN-2024-{numeric_id:05d}"
        return {
            "found": True,
            "order_id": order_id,
            "label_reference": label_ref,
            "label_url": f"https://returns.example.com/label/{label_ref}",
            "drop_off_instructions": (
                "Drop at any FedEx or UPS location. Bring the label — "
                "no box required, packaging materials are available at the counter."
            ),
            "refund_timeline": "3–5 business days after the warehouse scans the return.",
        }

    def _get_billing_charges(customer_id: str) -> dict[str, Any]:  # noqa: ARG001
        # Handle multi-charge array format: {"charges": [{"date", "amount", "description"}, ...]}
        if "charges" in context and isinstance(context["charges"], list):
            charges = [
                {
                    "id": f"CHG-{i+1:03d}",
                    "order_id": context.get("order_id"),
                    "amount": c.get("amount"),
                    "description": c.get("description", "Charge"),
                    "charged_at": c.get("date"),
                    "charge_type": (
                        "subscription" if "subscription" in c.get("description", "").lower()
                        else "add-on" if "add-on" in c.get("description", "").lower()
                        else "purchase"
                    ),
                }
                for i, c in enumerate(context["charges"])
            ]
            return {"found": True, "customer_id": customer_id, "charges": charges}
        # Handle single-charge format: {"charge_amount", "charge_description", "charge_date"}
        if "charge_amount" in context:
            charge_type = (
                "subscription"
                if "subscription" in context.get("charge_description", "").lower()
                else "purchase"
            )
            return {
                "found": True,
                "customer_id": customer_id,
                "charges": [
                    {
                        "id": "CHG-001",
                        "order_id": context.get("order_id"),
                        "amount": context.get("charge_amount"),
                        "description": context.get("charge_description", "Charge"),
                        "charged_at": context.get("charge_date"),
                        "charge_type": charge_type,
                    }
                ],
            }
        return {
            "found": False,
            "customer_id": customer_id,
            "message": "No billing charges found for this customer.",
        }

    def _get_order_history(customer_id: str) -> dict[str, Any]:  # noqa: ARG001
        return {
            "found": True,
            "customer_id": customer_id,
            "orders": [
                {
                    "id": order_id,
                    "status": context.get("status", "active"),
                    "item_description": context.get("product", "product"),
                    "total_amount": None,
                    "ordered_at": context.get("purchase_date", "2026-03-01"),
                    "delivered_at": None,
                }
            ],
        }

    _registry: dict[str, Callable[..., dict[str, Any]]] = {
        "lookup_customer": _lookup_customer,
        "get_order_details": _get_order_details,
        "check_return_eligibility": _check_return_eligibility,
        "get_return_label": _get_return_label,
        "get_billing_charges": _get_billing_charges,
        "get_order_history": _get_order_history,
    }

    def executor(name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
        fn = _registry.get(name)
        if fn is None:
            return {"error": f"Unknown tool: '{name}'"}
        try:
            return fn(**tool_input)
        except TypeError as exc:
            return {"error": f"Invalid input for tool '{name}': {exc}"}

    return executor
