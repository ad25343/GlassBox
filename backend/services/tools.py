"""
Non-LLM tool registry for the customer support agent.
All functions are deterministic DB reads — no probabilistic components.
Return dicts are serialised to JSON and passed back to the model as tool_result messages.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from backend.core import db
from backend.core.logging import get_logger

logger = get_logger(__name__)

RETURN_WINDOW_DAYS = 30


# ── Tool implementations ───────────────────────────────────────────────────────


def lookup_customer(last_name: str, order_id: str) -> dict[str, Any]:
    """Return customer record + order summary matched by last name and order ID."""
    with db.get_db() as conn:
        row = conn.execute(
            """
            SELECT c.id AS customer_id, c.first_name, c.last_name, c.email, c.phone,
                   o.id AS order_id, o.status AS order_status, o.item_description,
                   o.ordered_at, o.shipped_at, o.delivered_at,
                   o.carrier, o.tracking_number
            FROM customers c
            JOIN orders o ON o.customer_id = c.id
            WHERE LOWER(c.last_name) = LOWER(?) AND o.id = ?
            """,
            (last_name.strip(), order_id.strip()),
        ).fetchone()
    if row is None:
        return {
            "found": False,
            "message": (
                f"No customer found with last name '{last_name}' and order #{order_id}. "
                "Please verify the name and order number with the customer."
            ),
        }
    d = dict(row)
    logger.debug("lookup_customer hit", last_name=last_name, order_id=order_id)
    return {
        "found": True,
        "customer_id": d["customer_id"],
        "first_name": d["first_name"],
        "last_name": d["last_name"],
        "email": d["email"],
        "order_id": d["order_id"],
        "order_status": d["order_status"],
        "item_description": d["item_description"],
        "ordered_at": d["ordered_at"],
        "shipped_at": d["shipped_at"],
        "delivered_at": d["delivered_at"],
        "carrier": d["carrier"],
        "tracking_number": d["tracking_number"],
    }


def get_order_details(order_id: str) -> dict[str, Any]:
    """Return full order details: status, tracking, items, dates, last carrier scan."""
    with db.get_db() as conn:
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id.strip(),)).fetchone()
        if row is None:
            return {"found": False, "message": f"Order '{order_id}' not found."}
        d = dict(row)
        items = conn.execute(
            "SELECT name, sku, quantity, unit_price FROM order_items WHERE order_id = ?",
            (order_id.strip(),),
        ).fetchall()
    logger.debug("get_order_details hit", order_id=order_id)
    return {
        "found": True,
        "order_id": d["id"],
        "customer_id": d["customer_id"],
        "status": d["status"],
        "carrier": d["carrier"],
        "tracking_number": d["tracking_number"],
        "item_description": d["item_description"],
        "total_amount": d["total_amount"],
        "ordered_at": d["ordered_at"],
        "shipped_at": d["shipped_at"],
        "delivered_at": d["delivered_at"],
        "last_scan_at": d["last_scan_at"],
        "last_scan_location": d["last_scan_location"],
        "items": [dict(i) for i in items],
    }


def check_return_eligibility(order_id: str) -> dict[str, Any]:
    """Determine whether an order is eligible for return. Always call before mentioning refunds."""
    with db.get_db() as conn:
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id.strip(),)).fetchone()
    if row is None:
        return {"found": False, "message": f"Order '{order_id}' not found."}
    d = dict(row)
    if d["status"] != "delivered":
        return {
            "found": True,
            "order_id": order_id,
            "eligible": False,
            "reason": (
                f"Order is not in delivered status (current: {d['status']}). "
                "Returns are only accepted after delivery."
            ),
        }
    if not d["delivered_at"]:
        return {
            "found": True,
            "order_id": order_id,
            "eligible": False,
            "reason": "No delivery date on record for this order.",
        }
    delivered_dt = datetime.fromisoformat(d["delivered_at"])
    days_since = (datetime.now() - delivered_dt).days
    days_remaining = RETURN_WINDOW_DAYS - days_since
    eligible = days_remaining > 0
    logger.debug(
        "check_return_eligibility",
        order_id=order_id,
        eligible=eligible,
        days_remaining=days_remaining,
    )
    return {
        "found": True,
        "order_id": order_id,
        "eligible": eligible,
        "days_since_delivery": days_since,
        "days_remaining": max(0, days_remaining),
        "return_window_days": RETURN_WINDOW_DAYS,
        "reason": (
            f"Within return window — {days_remaining} days remaining."
            if eligible
            else (
                f"Return window expired. {days_since} days since delivery "
                f"(window is {RETURN_WINDOW_DAYS} days)."
            )
        ),
    }


def get_return_label(order_id: str) -> dict[str, Any]:
    """Generate a prepaid return shipping label reference and URL for an order."""
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT o.id, o.status FROM orders o WHERE o.id = ?",
            (order_id.strip(),),
        ).fetchone()
    if row is None:
        return {"found": False, "message": f"Order '{order_id}' not found."}
    # Derive label reference deterministically from order_id
    numeric_id = int(order_id) if order_id.isdigit() else abs(hash(order_id)) % 100000
    label_ref = f"RTN-2024-{numeric_id:05d}"
    label_url = f"https://returns.example.com/label/{label_ref}"
    logger.debug("get_return_label generated", order_id=order_id, label_ref=label_ref)
    return {
        "found": True,
        "order_id": order_id,
        "label_reference": label_ref,
        "label_url": label_url,
        "drop_off_instructions": (
            "Drop at any FedEx or UPS location. Bring the label — no box required, "
            "packaging materials are available at the drop-off counter."
        ),
        "refund_timeline": "3–5 business days after the warehouse scans the return.",
    }


def get_billing_charges(customer_id: str) -> dict[str, Any]:
    """Return billing charge history for a customer, with descriptions and amounts."""
    with db.get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, order_id, amount, description, charged_at, charge_type
            FROM billing_charges
            WHERE customer_id = ?
            ORDER BY charged_at DESC
            """,
            (customer_id.strip(),),
        ).fetchall()
    if not rows:
        return {
            "found": False,
            "customer_id": customer_id,
            "message": f"No billing charges found for customer '{customer_id}'.",
        }
    logger.debug("get_billing_charges hit", customer_id=customer_id, count=len(rows))
    return {
        "found": True,
        "customer_id": customer_id,
        "charges": [dict(r) for r in rows],
    }


def get_order_history(customer_id: str) -> dict[str, Any]:
    """Return all orders placed by a customer, with status and item summary."""
    with db.get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, status, item_description, total_amount, ordered_at, delivered_at
            FROM orders
            WHERE customer_id = ?
            ORDER BY ordered_at DESC
            """,
            (customer_id.strip(),),
        ).fetchall()
    logger.debug("get_order_history hit", customer_id=customer_id, count=len(rows))
    return {
        "found": True,
        "customer_id": customer_id,
        "orders": [dict(r) for r in rows],
    }


# ── Tool dispatch table ────────────────────────────────────────────────────────

_TOOL_REGISTRY: dict[str, Any] = {
    "lookup_customer": lookup_customer,
    "get_order_details": get_order_details,
    "check_return_eligibility": check_return_eligibility,
    "get_return_label": get_return_label,
    "get_billing_charges": get_billing_charges,
    "get_order_history": get_order_history,
}

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "lookup_customer",
        "description": (
            "Look up a customer record and their order summary by matching last name and order ID. "
            "Use this first whenever the customer provides their name and order number. "
            "Returns customer_id, name, email, and order status summary."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "last_name": {
                    "type": "string",
                    "description": "Customer's last name (case-insensitive).",
                },
                "order_id": {
                    "type": "string",
                    "description": "Order number — digits only (e.g. '7823').",
                },
            },
            "required": ["last_name", "order_id"],
        },
    },
    {
        "name": "get_order_details",
        "description": (
            "Get full order details: current status, carrier, tracking number, last carrier scan "
            "location and timestamp, ordered items, and delivery dates. "
            "Use after lookup_customer when you need more information about the order."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "order_id": {
                    "type": "string",
                    "description": "The order ID to retrieve details for.",
                },
            },
            "required": ["order_id"],
        },
    },
    {
        "name": "check_return_eligibility",
        "description": (
            "Check whether an order is eligible for return. Returns eligible (bool), "
            "days_since_delivery, days_remaining in return window, and reason. "
            "ALWAYS call this before mentioning refunds or returns — never assume eligibility."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "order_id": {
                    "type": "string",
                    "description": "The order ID to check return eligibility for.",
                },
            },
            "required": ["order_id"],
        },
    },
    {
        "name": "get_return_label",
        "description": (
            "Generate a prepaid return shipping label reference number and drop-off URL. "
            "Only call after confirming eligible: true from check_return_eligibility."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "order_id": {
                    "type": "string",
                    "description": "The order ID to generate a return label for.",
                },
            },
            "required": ["order_id"],
        },
    },
    {
        "name": "get_billing_charges",
        "description": (
            "Retrieve the billing charge history for a customer. "
            "Use for billing dispute tickets — returns a list of charges with descriptions, "
            "amounts, and dates. Only share charges that are present in this result."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {
                    "type": "string",
                    "description": "The customer ID (obtained from lookup_customer).",
                },
            },
            "required": ["customer_id"],
        },
    },
    {
        "name": "get_order_history",
        "description": (
            "Get all orders placed by a customer with status and item summary. "
            "Use when the customer does not have a specific order number, "
            "or when full order history context is needed."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {
                    "type": "string",
                    "description": "The customer ID (obtained from lookup_customer).",
                },
            },
            "required": ["customer_id"],
        },
    },
]


def execute_tool(name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Dispatch a named tool call and return its result dict."""
    fn = _TOOL_REGISTRY.get(name)
    if fn is None:
        logger.warning("unknown tool called", tool_name=name)
        return {"error": f"Unknown tool: '{name}'. Available tools: {list(_TOOL_REGISTRY.keys())}"}
    try:
        result = fn(**tool_input)
        logger.debug("tool executed", tool_name=name, found=result.get("found"))
        return result
    except TypeError as exc:
        logger.error("tool input error", tool_name=name, error=str(exc), input=tool_input)
        return {"error": f"Invalid input for tool '{name}': {exc}"}
