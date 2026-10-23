"""Read incremental text from the Windows Live Captions window via UI Automation."""

from __future__ import annotations

import queue
import re
import threading
from typing import Optional

import uiautomation as auto

from config import POLL_INTERVAL_MS

# Confirmed on Windows 11: ClassName is LiveCaptionsDesktopWindow
LIVE_CAPTIONS_CLASS = "LiveCaptionsDesktopWindow"

WINDOW_NOT_FOUND = "Windows Live Captions is not running"
WINDOW_LOST = "Live Caption window not found"

SKIP_LABELS = frozenset(
    {
        "live captions",
        "live caption",
        "settings",
        "options",
        "position",
        "more options",
        "caption style",
        "close",
        "minimize",
        "maximize",
        "system",
    }
)


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _norm_word(word: str) -> str:
    return re.sub(r"[^\w']+", "", word or "").lower()


def compute_delta(previous: str, current: str) -> tuple[str, str]:
    """Return (text_to_emit, new_last_text).

    Live Captions constantly revises earlier words and sometimes flickers
    between a short line and the full buffer. Only emit *end growth* —
    never re-send text that was already observed.
    """
    prev = normalize_whitespace(previous)
    curr = normalize_whitespace(current)

    if not curr:
        # Empty read is usually transient — keep prior state
        return "", prev
    if not prev:
        return curr, curr
    if curr == prev:
        return "", prev

    # Genuine rollback (caption shrank as a prefix of what we had)
    if prev.startswith(curr):
        return "", curr

    # Ignore short flickers (UI briefly exposes only the latest fragment)
    if len(curr) < len(prev) * 0.6:
        return "", prev

    # Clean append
    if curr.startswith(prev):
        return curr[len(prev) :].lstrip(), curr

    prev_words = prev.split()
    curr_words = curr.split()

    # Match leading words loosely (punctuation / capitalization churn)
    matched = 0
    for a, b in zip(prev_words, curr_words):
        if _norm_word(a) == _norm_word(b):
            matched += 1
        else:
            break

    # Same-or-fewer words with mid-string revision: update state, emit nothing
    if len(curr_words) <= len(prev_words):
        if matched >= max(1, int(len(prev_words) * 0.4)) or len(curr) >= len(prev) * 0.6:
            return "", curr
        # Unrelated short/medium string — ignore flicker
        return "", prev

    # Caption grew: emit only words beyond the previous word count so mid-string
    # revisions (wall -> wallet) do not re-inject earlier sentence text.
    if matched >= max(1, int(len(prev_words) * 0.3)) or curr.lower().find(
        " ".join(prev_words[: max(1, matched)]).lower()
    ) == 0 or matched > 0:
        new_words = curr_words[len(prev_words) :]
        return " ".join(new_words), curr

    # Scrolling window: longest suffix of prev that matches a prefix of curr
    max_k = min(len(prev_words), len(curr_words))
    for k in range(max_k, 0, -1):
        if [_norm_word(w) for w in prev_words[-k:]] == [_norm_word(w) for w in curr_words[:k]]:
            return " ".join(curr_words[k:]), curr

    # Brand-new utterance (very different from previous)
    from difflib import SequenceMatcher

    if SequenceMatcher(None, prev, curr).ratio() < 0.35:
        return curr, curr

    # Similar revision without reliable growth — don't re-emit
    return "", curr


def reset_automation_client() -> None:
    """Clear a broken AutomationClient singleton left by a failed CoInitialize."""
    try:
        client_cls = getattr(auto, "_AutomationClient", None)
        if client_cls is not None and getattr(client_cls, "_instance", None) is not None:
            client_cls._instance = None
    except Exception:
        pass


def control_strings(control: auto.Control) -> list[str]:
    """Collect readable strings via Name / Value / Text / LegacyIAccessible."""
    out: list[str] = []

    try:
        name = (control.Name or "").strip()
        if name:
            out.append(name)
    except Exception:
        pass

    try:
        pattern = control.GetValuePattern()
        if pattern and pattern.Value:
            value = str(pattern.Value).strip()
            if value:
                out.append(value)
    except Exception:
        pass

    try:
        text_pattern = control.GetTextPattern()
        if text_pattern:
            doc = text_pattern.DocumentRange
            if doc:
                value = (doc.GetText(-1) or "").strip()
                if value:
                    out.append(value)
    except Exception:
        pass

    try:
        legacy = control.GetLegacyIAccessiblePattern()
        if legacy:
            for attr in ("Name", "Value", "Description"):
                try:
                    value = getattr(legacy, attr, None)
                    if value and str(value).strip():
                        out.append(str(value).strip())
                except Exception:
                    pass
    except Exception:
        pass

    return out


class CaptionReader:
    """Polls Windows Live Captions and exposes thread-safe caption deltas."""

    def __init__(self, poll_interval_ms: int = POLL_INTERVAL_MS) -> None:
        self._poll_interval = max(50, int(poll_interval_ms)) / 1000.0
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._queue: queue.Queue[str] = queue.Queue()
        self._error_queue: queue.Queue[str] = queue.Queue()
        self._lock = threading.Lock()
        self._last_text = ""
        self._running = False
        self._needs_baseline = True

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._running

    def start(self) -> None:
        with self._lock:
            if self._running:
                return
            self._running = True
            self._stop_event.clear()
            # Do not clear _last_text here in a way that re-emits the buffer.
            # On restart we baseline from whatever Live Captions already shows.
            self._needs_baseline = True
            self._drain_queue(self._queue)
            self._drain_queue(self._error_queue)
            self._thread = threading.Thread(
                target=self._run_loop,
                name="CaptionReader",
                daemon=True,
            )
            self._thread.start()
            print("[CaptionReader] started")

    def stop(self) -> None:
        with self._lock:
            if not self._running:
                return
            self._running = False
            self._stop_event.set()
            thread = self._thread
            self._thread = None
        if thread and thread.is_alive():
            thread.join(timeout=2.0)
        print("[CaptionReader] stopped")

    def get_new_text(self) -> Optional[str]:
        try:
            return self._queue.get_nowait()
        except queue.Empty:
            return None

    def get_error(self) -> Optional[str]:
        try:
            return self._error_queue.get_nowait()
        except queue.Empty:
            return None

    @staticmethod
    def _drain_queue(q: queue.Queue) -> None:
        while True:
            try:
                q.get_nowait()
            except queue.Empty:
                break

    def _emit_error(self, message: str) -> None:
        print(f"[CaptionReader] error: {message}")
        self._error_queue.put(message)

    def _emit_text(self, text: str) -> None:
        cleaned = normalize_whitespace(text)
        # Drop leftover leading punctuation from mid-caption revisions
        cleaned = re.sub(r"^[^\w']+", "", cleaned).strip()
        if cleaned:
            print(f"[CaptionReader] delta: {cleaned!r}")
            self._queue.put(cleaned)

    def _find_live_captions_window(self) -> Optional[auto.Control]:
        """Locate Live Captions by class name or title via desktop children."""
        try:
            root = auto.GetRootControl()
            children = root.GetChildren()
        except Exception as exc:
            print(f"[CaptionReader] GetRootControl failed: {exc}")
            return None

        for child in children:
            try:
                cls = (getattr(child, "ClassName", None) or "").strip()
                name = (child.Name or "").strip()
            except Exception:
                continue

            if cls == LIVE_CAPTIONS_CLASS or "livecaption" in cls.lower().replace(" ", ""):
                return child
            if "live caption" in name.lower():
                return child

        return None

    def _extract_caption_text(self, window: auto.Control) -> str:
        candidates: list[str] = []

        def walk(control: auto.Control, depth: int = 0) -> None:
            if depth > 20:
                return
            try:
                ctype = control.ControlTypeName
            except Exception:
                return

            for value in control_strings(control):
                lowered = value.lower().strip()
                if not lowered or lowered in SKIP_LABELS:
                    continue
                if len(value) <= 1:
                    continue
                if ctype in (
                    "TextControl",
                    "DocumentControl",
                    "EditControl",
                    "GroupControl",
                    "PaneControl",
                    "CustomControl",
                    "ListControl",
                    "ListItemControl",
                ) or len(value) > 8:
                    candidates.append(normalize_whitespace(value))

            try:
                children = control.GetChildren()
            except Exception:
                children = []
            for child in children:
                walk(child, depth + 1)

        walk(window)
        if not candidates:
            return ""

        unique: list[str] = []
        seen: set[str] = set()
        for item in sorted(candidates, key=len, reverse=True):
            key = item.lower()
            if key in seen:
                continue
            if any(key in kept.lower() for kept in unique):
                continue
            seen.add(key)
            unique.append(item)

        if not unique:
            return ""
        return max(unique, key=len)

    def _run_loop(self) -> None:
        # COM/UI Automation must be initialized per-thread.
        reset_automation_client()
        with auto.UIAutomationInitializerInThread():
            window_missing_notified = False
            empty_extract_logged = False
            while not self._stop_event.is_set():
                try:
                    window = self._find_live_captions_window()
                except Exception as exc:
                    print(f"[CaptionReader] find failed: {exc}")
                    window = None

                if window is None:
                    if not window_missing_notified:
                        self._emit_error(WINDOW_NOT_FOUND)
                        window_missing_notified = True
                    self._stop_event.wait(self._poll_interval)
                    continue

                if window_missing_notified:
                    print("[CaptionReader] Live Captions window found")
                window_missing_notified = False

                try:
                    current = self._extract_caption_text(window)
                except Exception as exc:
                    print(f"[CaptionReader] extract failed: {exc}")
                    self._emit_error(WINDOW_LOST)
                    self._stop_event.wait(self._poll_interval)
                    continue

                if not current:
                    if not empty_extract_logged:
                        print(
                            "[CaptionReader] window found but no caption text yet "
                            "(speak something, or wait for captions to appear)"
                        )
                        empty_extract_logged = True
                else:
                    empty_extract_logged = False

                with self._lock:
                    # On START/restart: adopt current caption buffer as baseline
                    # without emitting, so only text that appears afterward is sent.
                    if self._needs_baseline:
                        if current:
                            self._last_text = current
                            self._needs_baseline = False
                            print(
                                f"[CaptionReader] baseline set "
                                f"({len(current)} chars); waiting for new speech"
                            )
                        # If empty, keep trying until we can baseline
                    else:
                        previous = self._last_text
                        delta, new_last = compute_delta(previous, current)
                        self._last_text = new_last
                        if delta:
                            self._emit_text(delta)

                self._stop_event.wait(self._poll_interval)
