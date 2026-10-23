"""API behavior tests with Databricks and Ollama calls replaced by mocks."""

from datetime import date, datetime
from unittest.mock import Mock, call

import pytest
from fastapi.testclient import TestClient

import main as api


@pytest.fixture(autouse=True)
def guard_external_calls(monkeypatch):
    """Fail unexpected service calls rather than contact real services."""
    for name in (
        "check_connection",
        "fetch_distinct_products",
        "fetch_forecast_predictions",
        "fetch_forecasts",
        "fetch_history_actuals",
        "fetch_product_static",
        "fetch_products",
        "fetch_recent_sales_features",
        "fetch_stores",
        "run_chat",
        "run_quick_action",
        "generate_explanation",
    ):
        monkeypatch.setattr(
            api, name,
            Mock(side_effect=AssertionError(f"Unexpected service call: {name}")),
        )

    for name in ("upload_file_to_volume", "trigger_job", "get_run_status"):
        monkeypatch.setattr(
            api.databricks_jobs, name,
            Mock(side_effect=AssertionError(f"Unexpected Databricks call: {name}")),
        )

    monkeypatch.setattr(
        api.analytics, "get_kpi_summary",
        Mock(side_effect=AssertionError("Unexpected analytics call")),
    )


@pytest.fixture
def client():
    with TestClient(api.app) as test_client:
        yield test_client


@pytest.mark.parametrize(
    "series",
    [{}, {"product_id": "P1"}, {"store_id": "S1"}],
)
def test_history_requires_product_and_store(client, series):
    response = client.get(
        "/forecast", params={"include_history": "true", **series}
    )

    assert response.status_code == 400
    api.fetch_history_actuals.assert_not_called()
    api.fetch_forecast_predictions.assert_not_called()


@pytest.mark.parametrize("days", [0, -1])
def test_history_rejects_nonpositive_days(client, days):
    response = client.get(
        "/forecast",
        params={
            "include_history": "true",
            "product_id": "P1",
            "store_id": "S1",
            "history_days": days,
        },
    )

    assert response.status_code == 422
    api.fetch_history_actuals.assert_not_called()


def test_history_merges_dates_without_losing_actuals(client):
    api.fetch_history_actuals.side_effect = None
    api.fetch_history_actuals.return_value = [
        {"date": date(2026, 10, 2), "units_sold": 20},
        {"date": date(2026, 10, 1), "units_sold": 10},
    ]
    api.fetch_forecast_predictions.side_effect = None
    api.fetch_forecast_predictions.return_value = [
        {"forecast_date": datetime(2026, 10, 3, 12), "predicted_units": 30},
        {"forecast_date": datetime(2026, 10, 2, 18), "predicted_units": 21},
    ]

    response = client.get(
        "/forecast",
        params={
            "include_history": "true",
            "product_id": "P1",
            "store_id": "S1",
            "history_days": 7,
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "product_id": "P1",
        "store_id": "S1",
        "history_days": 7,
        "points": [
            {"date": "2026-10-01", "actual_units": 10, "predicted_units": None},
            {"date": "2026-10-02", "actual_units": 20, "predicted_units": 21},
            {"date": "2026-10-03", "actual_units": None, "predicted_units": 30},
        ],
    }
    api.fetch_history_actuals.assert_called_once_with("P1", "S1", 7)
    api.fetch_forecast_predictions.assert_called_once_with("P1", "S1")


def test_database_failure_returns_safe_error(client):
    diagnostic = "internal-warehouse-diagnostic"
    api.fetch_forecasts.side_effect = RuntimeError(diagnostic)

    response = client.get("/forecast")

    assert response.status_code == 500
    assert diagnostic not in response.text
    assert "Failed to fetch forecast data" in response.json()["detail"]


def test_chat_preserves_history_and_store_context(client):
    history = [{"role": "user", "content": "Earlier question"}]
    expected = {
        "answer": "Test answer",
        "data": {"units": 25},
        "functions_used": ["test_analytics"],
    }
    api.run_chat.side_effect = None
    api.run_chat.return_value = expected

    response = client.post(
        "/chat",
        json={
            "message": "What changed?",
            "history": history,
            "store_id": "S1",
            "store_name": "Test store",
        },
    )

    assert response.status_code == 200
    assert response.json() == expected
    api.run_chat.assert_called_once_with(
        "What changed?",
        history=history,
        store_id="S1",
        store_name="Test store",
    )


@pytest.mark.parametrize("status", [429, 502, 503])
def test_chat_preserves_service_error_status(client, status):
    api.run_chat.side_effect = api.LLMServiceError(
        "Test service error", status_code=status
    )

    response = client.post("/chat", json={"message": "Hello"})

    assert response.status_code == status
    assert response.json() == {"detail": "Test service error"}
    api.run_chat.assert_called_once()


def test_chat_rejects_missing_message_before_service_call(client):
    response = client.post("/chat", json={})

    assert response.status_code == 422
    api.run_chat.assert_not_called()


def test_invalid_batch_uploads_nothing(client):
    response = client.post(
        "/pipeline/upload-and-trigger",
        files={
            "sales_transactions_file": (
                "sales_transactions.csv", b"date,units\n", "text/csv"
            ),
            "calendar_marketing_file": (
                "calendar_marketing_external.txt", b"date,event\n", "text/plain"
            ),
        },
    )

    assert response.status_code == 400
    api.databricks_jobs.upload_file_to_volume.assert_not_called()
    api.databricks_jobs.trigger_job.assert_not_called()


def test_valid_files_upload_before_job_trigger(client, monkeypatch):
    operations = Mock()
    operations.upload.side_effect = (
        lambda filename, content: f"/Volumes/test/incoming/{filename}"
    )
    operations.trigger.return_value = 123

    monkeypatch.setattr(
        api.databricks_jobs, "upload_file_to_volume", operations.upload
    )
    monkeypatch.setattr(api.databricks_jobs, "trigger_job", operations.trigger)

    sales = b"date,units\n2026-10-01,2\n"
    calendar = b"date,event\n2026-10-01,promotion\n"

    response = client.post(
        "/pipeline/upload-and-trigger",
        files={
            "sales_transactions_file": (
                "sales_transactions.csv", sales, "text/csv"
            ),
            "calendar_marketing_file": (
                "calendar_marketing_external.csv", calendar, "text/csv"
            ),
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "files": [
            {
                "filename": "sales_transactions.csv",
                "volume_path": "/Volumes/test/incoming/sales_transactions.csv",
            },
            {
                "filename": "calendar_marketing_external.csv",
                "volume_path": "/Volumes/test/incoming/calendar_marketing_external.csv",
            },
        ],
        "run_id": 123,
        "status": "triggered",
    }
    assert operations.mock_calls == [
        call.upload("sales_transactions.csv", sales),
        call.upload("calendar_marketing_external.csv", calendar),
        call.trigger(),
    ]

