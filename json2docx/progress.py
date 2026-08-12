from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class TimelineEntry:
    elapsed_s: float
    percent: int
    kind: str
    message: str
    wall_time: str


class Progress:
    """Console progress with percentage and worked timeline (Windows-safe ASCII)."""

    def __init__(self) -> None:
        self._t0 = 0.0
        self._title = ""
        self._percent = 0
        self._timeline: list[TimelineEntry] = []

    def begin(self, title: str) -> None:
        self._t0 = time.perf_counter()
        self._title = title
        self._percent = 0
        self._timeline = []
        started = datetime.now().strftime("%H:%M:%S")
        self._print(f"\n=== {title} ===")
        self._print(f"Started: {started}")
        self._record(0, "start", "Generation started")

    def step(self, message: str, *, weight: int) -> None:
        self._percent = min(100, self._percent + max(0, weight))
        self._record(self._percent, "step", message)
        self._print(f"[{self._percent:3d}%] {self._wall()}  {message}")

    def ok(self, message: str) -> None:
        self._record(self._percent, "ok", message)
        self._print(f"              OK   {message}")

    def detail(self, message: str) -> None:
        self._record(self._percent, "detail", message)
        self._print(f"              - {message}")

    def warn(self, message: str) -> None:
        self._record(self._percent, "warn", message)
        self._print(f"              WARN {message}")

    def fail(self, message: str) -> None:
        self._record(self._percent, "fail", message)
        self._print(f"              FAIL {message}")

    def done(self, message: str) -> None:
        elapsed = time.perf_counter() - self._t0
        self._percent = 100
        self._record(100, "done", message)
        self._print(f"=== Finished in {elapsed:.1f}s (100%) - {message} ===")
        self.print_timeline()

    def aborted(self, message: str) -> None:
        elapsed = time.perf_counter() - self._t0
        self._record(self._percent, "abort", message)
        self._print(f"=== Aborted in {elapsed:.1f}s ({self._percent}%) - {message} ===")
        self.print_timeline()

    def print_timeline(self) -> None:
        if not self._timeline:
            return
        self._print("\nTimeline:")
        for entry in self._timeline:
            sign = {"ok": "+", "detail": ".", "warn": "!", "fail": "X", "step": ">", "done": "*", "start": "-", "abort": "X"}.get(entry.kind, " ")
            self._print(
                f"  {entry.wall_time}  +{entry.elapsed_s:6.2f}s  [{entry.percent:3d}%] {sign} {entry.message}"
            )
        self._print("")

    def _wall(self) -> str:
        return datetime.now().strftime("%H:%M:%S")

    def _record(self, percent: int, kind: str, message: str) -> None:
        self._timeline.append(
            TimelineEntry(
                elapsed_s=time.perf_counter() - self._t0,
                percent=percent,
                kind=kind,
                message=message,
                wall_time=self._wall(),
            )
        )

    @staticmethod
    def _print(message: str) -> None:
        print(message, flush=True)
