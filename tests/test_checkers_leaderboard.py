import os
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import app as game_app

REAL_DB_CONNECTION = game_app.db_connection


class FakeCursor:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class FakeCheckersDatabase:
    def __init__(self):
        self.records = []

    @contextmanager
    def connect(self):
        yield self

    def execute(self, query, params=()):
        normalized = " ".join(query.lower().split())

        if normalized.startswith("insert into checkers_leaderboard"):
            player_id, time_taken_ms, blue_steps = params
            existing = next(
                (row for row in self.records if row["player_id"] == player_id),
                None,
            )
            updated = existing is None

            if existing is not None:
                updated = (time_taken_ms, blue_steps) < (
                    existing["time_taken_ms"],
                    existing["blue_steps"],
                )

            if updated:
                now = datetime.now(timezone.utc)
                if existing is None:
                    existing = {
                        "id": len(self.records) + 1,
                        "player_id": player_id,
                    }
                    self.records.append(existing)
                existing.update(
                    time_taken_ms=time_taken_ms,
                    blue_steps=blue_steps,
                    created_at=now,
                )
                return FakeCursor(row={"id": existing["id"]})

            return FakeCursor()

        if normalized.startswith("with ranked_players"):
            ranked = sorted(
                self.records,
                key=lambda row: (
                    row["time_taken_ms"],
                    row["blue_steps"],
                    row["created_at"],
                    row["id"],
                ),
            )
            for rank, row in enumerate(ranked, start=1):
                if row["player_id"] == params[0]:
                    return FakeCursor(
                        row={
                            "rank": rank,
                            "time_taken_ms": row["time_taken_ms"],
                            "blue_steps": row["blue_steps"],
                        }
                    )
            return FakeCursor()

        if normalized.startswith("select player_id, time_taken_ms, blue_steps"):
            ranked = sorted(
                self.records,
                key=lambda row: (
                    row["time_taken_ms"],
                    row["blue_steps"],
                    row["created_at"],
                    row["id"],
                ),
            )
            return FakeCursor(rows=ranked[:50])

        raise AssertionError(f"Unexpected SQL in test: {query}")


class FakeGuessDatabase:
    def __init__(self):
        self.records = []

    @contextmanager
    def connect(self):
        yield self

    def execute(self, query, params=()):
        normalized = " ".join(query.lower().split())

        if normalized.startswith("select pg_advisory_xact_lock"):
            return FakeCursor()

        if normalized.startswith("select id, attempts, time_taken from leaderboard"):
            level, username = params
            matching = [
                row for row in self.records
                if row["level"] == level and row["username"].lower() == username.lower()
            ]
            matching.sort(
                key=lambda row: (
                    row["attempts"],
                    row["time_taken"],
                    row["created_at"],
                    row["id"],
                )
            )
            return FakeCursor(row=matching[0] if matching else None)

        if normalized.startswith("insert into leaderboard"):
            level, username, attempts, time_taken = params
            self.records.append(
                {
                    "id": len(self.records) + 1,
                    "level": level,
                    "username": username,
                    "attempts": attempts,
                    "time_taken": time_taken,
                    "created_at": datetime.now(timezone.utc),
                }
            )
            return FakeCursor()

        if normalized.startswith("with ranked_players"):
            if "select username, attempts, time_taken, created_at" in normalized:
                level = params[0]
                rows = [row.copy() for row in self.records if row["level"] == level]
                rows.sort(
                    key=lambda row: (
                        row["attempts"],
                        row["time_taken"],
                        row["created_at"],
                        row["id"],
                    )
                )
                unique = []
                seen = set()
                for row in rows:
                    name = row["username"].strip().lower()
                    if name not in seen:
                        seen.add(name)
                        unique.append(row)
                return FakeCursor(rows=unique[:50])

            level = params[0]
            best_by_player = {}
            for row in self.records:
                if row["level"] != level:
                    continue
                name = row["username"].strip().lower()
                if name not in best_by_player or (
                    row["attempts"],
                    row["time_taken"],
                    row["created_at"],
                    row["id"],
                ) < (
                    best_by_player[name]["attempts"],
                    best_by_player[name]["time_taken"],
                    best_by_player[name]["created_at"],
                    best_by_player[name]["id"],
                ):
                    best_by_player[name] = row

            ordered = sorted(
                best_by_player.items(),
                key=lambda item: (
                    item[1]["attempts"],
                    item[1]["time_taken"],
                    item[1]["created_at"],
                    item[1]["id"],
                ),
            )
            return FakeCursor(
                rows=[
                    {"rank": rank, "normalized_username": name}
                    for rank, (name, _) in enumerate(ordered, start=1)
                ]
            )

        raise AssertionError(f"Unexpected SQL in test: {query}")


class FakeSchemaConnection:
    def __init__(self):
        self.statements = []

    def execute(self, query, params=()):
        self.statements.append(query)
        return FakeCursor()

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


class CheckersLeaderboardTests(unittest.TestCase):
    def setUp(self):
        game_app.app.config.update(TESTING=True)
        self.client = game_app.app.test_client()
        self.database = FakeCheckersDatabase()
        self.database_patch = patch.object(
            game_app,
            "db_connection",
            self.database.connect,
        )
        self.database_patch.start()
        self.addCleanup(self.database_patch.stop)

    def test_only_blue_wins_are_accepted(self):
        response = self.client.post(
            "/api/checkers/score",
            json={
                "winner": "red",
                "time_taken_ms": 12000,
                "blue_steps": 9,
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.database.records, [])

    def test_one_best_score_per_session_and_time_then_steps_order(self):
        first = self.client.post(
            "/api/checkers/score",
            json={
                "winner": "blue",
                "time_taken_ms": 12000,
                "blue_steps": 20,
            },
        )
        self.assertEqual(first.status_code, 201)
        self.assertTrue(first.get_json()["updated"])
        with self.client.session_transaction() as session:
            original_player_id = session["player_id"]

        worse = self.client.post(
            "/api/checkers/score",
            json={
                "winner": "blue",
                "time_taken_ms": 13000,
                "blue_steps": 3,
            },
        )
        self.assertFalse(worse.get_json()["updated"])
        self.assertEqual(len(self.database.records), 1)
        self.assertEqual(self.database.records[0]["time_taken_ms"], 12000)

        better_tie = self.client.post(
            "/api/checkers/score",
            json={
                "winner": "blue",
                "time_taken_ms": 12000,
                "blue_steps": 19,
            },
        )
        self.assertTrue(better_tie.get_json()["updated"])

        faster = self.client.post(
            "/api/checkers/score",
            json={
                "winner": "blue",
                "time_taken_ms": 11000,
                "blue_steps": 50,
            },
        )
        self.assertTrue(faster.get_json()["updated"])
        self.assertEqual(len(self.database.records), 1)
        self.assertEqual(
            self.database.records[0]["player_id"],
            original_player_id,
        )

        second_player = game_app.app.test_client()
        second_player.post(
            "/api/checkers/score",
            json={
                "winner": "blue",
                "time_taken_ms": 12000,
                "blue_steps": 18,
            },
        )
        third_player = game_app.app.test_client()
        third_player.post(
            "/api/checkers/score",
            json={
                "winner": "blue",
                "time_taken_ms": 12000,
                "blue_steps": 17,
            },
        )

        response = self.client.get("/api/checkers/leaderboard")
        self.assertEqual(response.status_code, 200)
        rows = response.get_json()
        self.assertEqual(
            [(row["time_taken_ms"], row["blue_steps"]) for row in rows],
            [(11000, 50), (12000, 17), (12000, 18)],
        )
        self.assertNotIn(original_player_id, str(rows))

    def test_leaderboard_is_limited_to_50_and_scrollable_ui_exists(self):
        base_time = datetime(2026, 10, 31, tzinfo=timezone.utc)
        self.database.records = [
            {
                "id": index,
                "player_id": f"player-{index}",
                "time_taken_ms": index * 1000,
                "blue_steps": 10,
                "created_at": base_time + timedelta(seconds=index),
            }
            for index in range(1, 56)
        ]

        response = self.client.get("/api/checkers/leaderboard")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.get_json()), 50)
        self.assertEqual(response.get_json()[0]["rank"], 1)

        html = self.client.get("/checkers").get_data(as_text=True)
        self.assertIn("checkers-leaderboard-scroll", html)
        self.assertIn("checkers-leaderboard-rows", html)

    def test_schema_adds_separate_table_without_deleting_data(self):
        schema_connection = FakeSchemaConnection()
        ready_before = game_app._schema_ready
        try:
            game_app._schema_ready = False
            with patch.dict(os.environ, {"NEON_DATABASE_URL": "test-only-dsn"}):
                with patch.object(
                    game_app.psycopg,
                    "connect",
                    return_value=schema_connection,
                ):
                    with patch.object(
                        game_app,
                        "db_connection",
                        REAL_DB_CONNECTION,
                    ):
                        with game_app.db_connection():
                            pass
        finally:
            game_app._schema_ready = ready_before

        statements = [query.lower() for query in schema_connection.statements]
        self.assertTrue(
            any("create table if not exists checkers_leaderboard" in query for query in statements)
        )
        self.assertFalse(any("delete from leaderboard" in query for query in statements))
        self.assertFalse(any("delete from personal_best_scores" in query for query in statements))

    def test_guess_leaderboard_route_remains_available(self):
        guess_database = FakeGuessDatabase()
        with patch.object(game_app, "db_connection", guess_database.connect):
            saved = self.client.post(
                "/api/score",
                json={
                    "username": "guess-player",
                    "level": 100,
                    "attempts": 3,
                    "time_taken": 4.5,
                },
            )
            self.assertEqual(saved.status_code, 201)
            self.assertTrue(saved.get_json()["updated"])

            leaderboard = self.client.get("/api/leaderboard?level=100")
            self.assertEqual(leaderboard.status_code, 200)
            self.assertEqual(leaderboard.get_json()[0]["username"], "guess-player")

        with patch.object(game_app, "load_best", return_value=3):
            best_scores = self.client.get("/api/best_scores")
        self.assertEqual(best_scores.status_code, 200)
        self.assertEqual(best_scores.get_json(), {"100": 3, "1000": 3, "10000": 3})

        for path in ("/api/leaderboard", "/api/score"):
            active_rules = [
                rule
                for rule in game_app.app.url_map.iter_rules()
                if rule.rule == path
            ]
            self.assertEqual(len(active_rules), 1)


if __name__ == "__main__":
    unittest.main()
