"""Tests for the non-LLM tool registry (backend/services/tools.py).

All tests use the tmp_db fixture so they never hit the real glassbox.db.
No LLM calls are made — these are pure deterministic DB-read functions.
"""
from __future__ import annotations


from backend.services.tools import (
    check_return_eligibility,
    execute_tool,
    get_billing_charges,
    get_order_details,
    get_order_history,
    get_return_label,
    lookup_customer,
)


# ── lookup_customer ────────────────────────────────────────────────────────────

class TestLookupCustomer:
    def test_happy_path_sarah_chen(self, tmp_db):
        result = lookup_customer("Chen", "7823")
        assert result["found"] is True
        assert result["first_name"] == "Sarah"
        assert result["last_name"] == "Chen"
        assert result["customer_id"] == "CUST-1001"
        assert result["order_id"] == "7823"
        assert result["order_status"] == "in_transit"
        assert result["carrier"] == "FedEx"

    def test_happy_path_case_insensitive(self, tmp_db):
        # last_name matching should be case-insensitive
        result = lookup_customer("CHEN", "7823")
        assert result["found"] is True
        assert result["first_name"] == "Sarah"

    def test_not_found_wrong_order(self, tmp_db):
        result = lookup_customer("Chen", "9999")
        assert result["found"] is False
        assert "9999" in result["message"]

    def test_not_found_wrong_name(self, tmp_db):
        result = lookup_customer("Smith", "7823")
        assert result["found"] is False
        assert "Smith" in result["message"]

    def test_returns_email(self, tmp_db):
        result = lookup_customer("Rodriguez", "4521")
        assert result["found"] is True
        assert "@" in result["email"]


# ── get_order_details ──────────────────────────────────────────────────────────

class TestGetOrderDetails:
    def test_happy_path_delivered_order(self, tmp_db):
        result = get_order_details("4521")
        assert result["found"] is True
        assert result["status"] == "delivered"
        assert result["carrier"] == "UPS"
        assert result["customer_id"] == "CUST-1002"
        assert isinstance(result["items"], list)
        assert len(result["items"]) == 1
        assert result["items"][0]["name"] == "Bluetooth Speaker"

    def test_happy_path_in_transit(self, tmp_db):
        result = get_order_details("7823")
        assert result["found"] is True
        assert result["status"] == "in_transit"
        assert result["last_scan_location"] == "Memphis Distribution Hub"

    def test_not_found(self, tmp_db):
        result = get_order_details("0000")
        assert result["found"] is False

    def test_cancelled_order(self, tmp_db):
        result = get_order_details("3345")
        assert result["found"] is True
        assert result["status"] == "cancelled"
        assert result["shipped_at"] is None


# ── check_return_eligibility ───────────────────────────────────────────────────

class TestCheckReturnEligibility:
    def test_eligible_within_window(self, tmp_db):
        # James Rodriguez order — delivered 18 days ago, 12 days remaining
        result = check_return_eligibility("4521")
        assert result["found"] is True
        assert result["eligible"] is True
        assert result["days_remaining"] == 12
        assert result["days_since_delivery"] == 18
        assert result["return_window_days"] == 30

    def test_not_eligible_not_delivered(self, tmp_db):
        # Sarah Chen order — in_transit
        result = check_return_eligibility("7823")
        assert result["found"] is True
        assert result["eligible"] is False
        assert "in_transit" in result["reason"].lower() or "not in delivered" in result["reason"].lower()

    def test_not_eligible_cancelled(self, tmp_db):
        result = check_return_eligibility("3345")
        assert result["found"] is True
        assert result["eligible"] is False

    def test_not_found(self, tmp_db):
        result = check_return_eligibility("0000")
        assert result["found"] is False

    def test_result_includes_reason(self, tmp_db):
        result = check_return_eligibility("4521")
        assert "reason" in result
        assert len(result["reason"]) > 0


# ── get_return_label ───────────────────────────────────────────────────────────

class TestGetReturnLabel:
    def test_happy_path(self, tmp_db):
        result = get_return_label("4521")
        assert result["found"] is True
        assert result["order_id"] == "4521"
        assert result["label_reference"].startswith("RTN-2024-")
        assert result["label_url"].startswith("https://returns.example.com/label/")
        assert "FedEx" in result["drop_off_instructions"] or "UPS" in result["drop_off_instructions"]
        assert "business days" in result["refund_timeline"]

    def test_label_reference_deterministic(self, tmp_db):
        # Same order always gets the same label ref
        r1 = get_return_label("4521")
        r2 = get_return_label("4521")
        assert r1["label_reference"] == r2["label_reference"]

    def test_not_found(self, tmp_db):
        result = get_return_label("0000")
        assert result["found"] is False


# ── get_billing_charges ────────────────────────────────────────────────────────

class TestGetBillingCharges:
    def test_happy_path_priya(self, tmp_db):
        result = get_billing_charges("CUST-1003")
        assert result["found"] is True
        assert result["customer_id"] == "CUST-1003"
        assert len(result["charges"]) == 1
        charge = result["charges"][0]
        assert charge["amount"] == 89.0
        assert "Headphones" in charge["description"]
        assert charge["charge_type"] == "purchase"

    def test_multiple_charges(self, tmp_db):
        # CUST-1001 has one charge
        result = get_billing_charges("CUST-1001")
        assert result["found"] is True
        assert len(result["charges"]) >= 1

    def test_customer_no_charges(self, tmp_db):
        result = get_billing_charges("CUST-9999")
        assert result["found"] is False

    def test_charge_fields_present(self, tmp_db):
        result = get_billing_charges("CUST-1002")
        charge = result["charges"][0]
        for field in ("id", "order_id", "amount", "description", "charged_at", "charge_type"):
            assert field in charge


# ── get_order_history ──────────────────────────────────────────────────────────

class TestGetOrderHistory:
    def test_happy_path(self, tmp_db):
        result = get_order_history("CUST-1001")
        assert result["found"] is True
        assert result["customer_id"] == "CUST-1001"
        assert len(result["orders"]) >= 1
        order = result["orders"][0]
        for field in ("id", "status", "item_description", "total_amount", "ordered_at"):
            assert field in order

    def test_customer_with_no_orders(self, tmp_db):
        result = get_order_history("CUST-9999")
        # Returns found: True with empty list (customer_id is not validated against customers table)
        assert "orders" in result

    def test_order_history_sorted_newest_first(self, tmp_db):
        result = get_order_history("CUST-1001")
        orders = result["orders"]
        if len(orders) > 1:
            dates = [o["ordered_at"] for o in orders]
            assert dates == sorted(dates, reverse=True)


# ── execute_tool (dispatcher) ──────────────────────────────────────────────────

class TestExecuteTool:
    def test_dispatch_lookup_customer(self, tmp_db):
        result = execute_tool("lookup_customer", {"last_name": "Chen", "order_id": "7823"})
        assert result["found"] is True

    def test_dispatch_unknown_tool(self, tmp_db):
        result = execute_tool("nonexistent_tool", {})
        assert "error" in result
        assert "nonexistent_tool" in result["error"]

    def test_dispatch_bad_input(self, tmp_db):
        # Missing required arg — should return error dict, not raise
        result = execute_tool("lookup_customer", {"last_name": "Chen"})
        assert "error" in result

    def test_all_tools_registered(self, tmp_db):
        from backend.services.tools import _TOOL_REGISTRY
        expected = {
            "lookup_customer",
            "get_order_details",
            "check_return_eligibility",
            "get_return_label",
            "get_billing_charges",
            "get_order_history",
        }
        assert expected == set(_TOOL_REGISTRY.keys())
