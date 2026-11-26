"""JSON error responses for the API."""

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException


def _error_body(code: int, name: str, message: str) -> dict[str, object]:
    return {"error": {"code": code, "name": name, "message": message}}


def register_error_handlers(app: Flask) -> None:
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
