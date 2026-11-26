"""JSON error responses for the API."""

from http import HTTPStatus

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException


class ApiError(Exception):
    """An expected, client-facing error that maps directly to an HTTP status code."""

    def __init__(self, status_code: int, message: str, details: dict[str, str] | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        # Optional per-field messages, e.g. {"quantity": "Enter a number greater than zero."}
        self.details = details


def _error_body(
    code: int, name: str, message: str, details: dict[str, str] | None = None
) -> dict[str, object]:
    error: dict[str, object] = {"code": code, "name": name, "message": message}
    if details:
        error["details"] = details
    return {"error": error}


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def handle_api_error(error: ApiError):
        name = HTTPStatus(error.status_code).phrase
        body = _error_body(error.status_code, name, error.message, error.details)
        return jsonify(body), error.status_code

    @app.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException):
        code = error.code or 500
        return jsonify(_error_body(code, error.name, error.description or error.name)), code

    @app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception):
        app.logger.exception("Unhandled application error: %s", error)
        return jsonify(
            _error_body(500, "Internal Server Error", "An unexpected error occurred.")
        ), 500
