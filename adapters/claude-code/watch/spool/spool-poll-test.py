#!/usr/bin/env python3
"""Tests for spool-poll.py: the stdlib alone (unittest), no network.

    python3 adapters/claude-code/watch/spool/spool-poll-test.py

The command the poller peeks with is faked: a function standing for subprocess.run in the unit
tests, and a small Python script in a temporary folder for the keep-alive, which starts a real
detached poller and stops it again. Kit #16.
"""
import importlib.util
import io
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

sys.dont_write_bytecode = True
HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("spool_poll", HERE / "spool-poll.py")
sp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sp)

# What `evr-mail recv --peek` prints (the desk's lelle-watch.py reads the same).
LELLE_MATCH = r"^--- \d+/\d+\s+from=(?P<from>\S+)\s+id=(?P<id>\S+)(?:\nsubject: (?P<subject>.*))?"
LELLE_LINE = "from={from} id={id} subject={subject}"


def peek_output(*envelopes):
    out = [f"collected {len(envelopes)}"]
    for i, (sender, env_id, subject) in enumerate(envelopes, 1):
        out.append(f"--- {i}/{len(envelopes)} from={sender} id={env_id}")
        out.append(f"subject: {subject}")
        out.append("body text that is not an item")
    return "\n".join(out) + "\n"


class FakeRun:
    """subprocess.run for the poller: answers from a queue, records each call."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = []

    def __call__(self, argv, **kw):
        self.calls.append((list(argv), kw))
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, BaseException):
            raise answer
        rc, out = answer
        return subprocess.CompletedProcess(argv, rc, out, "boom" if rc else "")


class Folder(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.spool = self.dir / "inbound" / "lelle-spool.txt"

    def tearDown(self):
        self.tmp.cleanup()

    def poller(self, run, **kw):
        args = dict(spool=self.spool, match=LELLE_MATCH, line=LELLE_LINE, healthy="^collected", command=["evr-mail", "recv", "--peek"])
        args.update(kw)
        return sp.Poller(sp.Config(**args), run=run)

    def lines(self):
        return self.spool.read_text(encoding="utf-8").splitlines() if self.spool.exists() else []


class Items(unittest.TestCase):
    def test_each_match_is_an_item_keyed_by_id_and_written_by_the_template(self):
        out = peek_output(("pepys", "a1", "Hello"), ("semafor", "b2", "Re: x"))
        self.assertEqual(
            sp.items(out, LELLE_MATCH, LELLE_LINE),
            [("a1", "from=pepys id=a1 subject=Hello"), ("b2", "from=semafor id=b2 subject=Re: x")],
        )

    def test_an_absent_group_is_empty_and_the_default_line_is_the_match_on_one_line(self):
        self.assertEqual(sp.items("--- 1/1 from=x id=z\n", LELLE_MATCH, LELLE_LINE), [("z", "from=x id=z subject=")])
        self.assertEqual(sp.items(peek_output(("x", "z", "S")), LELLE_MATCH, None), [("z", "--- 1/1 from=x id=z subject: S")])

    def test_a_pattern_without_an_id_group_is_refused(self):
        with self.assertRaises(ValueError):
            sp.check_pattern(r"^from=(\S+)")
        with self.assertRaises(ValueError):
            sp.check_pattern(r"(")
        sp.check_pattern(LELLE_MATCH)


class Poll(Folder):
    def test_new_envelopes_are_spooled_once_each_and_the_command_only_peeks(self):
        run = FakeRun((0, peek_output(("pepys", "a1", "Hello"))), (0, peek_output(("pepys", "a1", "Hello"), ("hr2", "c3", "Two"))))
        p = self.poller(run)
        p.poll(now=0)
        p.poll(now=30)
        p.poll(now=60)
        self.assertEqual(self.lines(), ["from=pepys id=a1 subject=Hello", "from=hr2 id=c3 subject=Two"])
        self.assertEqual([c[0] for c in run.calls], [["evr-mail", "recv", "--peek"]] * 3)

    def test_seen_ids_survive_a_restart_and_keep_the_last_500(self):
        p = self.poller(FakeRun((0, peek_output(("pepys", "a1", "Hello")))))
        p.poll(now=0)
        seen = self.dir / "inbound" / ".lelle-spool-seen.json"
        self.assertEqual(json.loads(seen.read_text(encoding="utf-8")), ["a1"])
        again = self.poller(FakeRun((0, peek_output(("pepys", "a1", "Hello")))))
        again.poll(now=0)
        self.assertEqual(self.lines(), ["from=pepys id=a1 subject=Hello"])
        many = [("x", f"id{i}", "s") for i in range(520)]
        self.poller(FakeRun((0, peek_output(*many)))).poll(now=0)
        kept = json.loads(seen.read_text(encoding="utf-8"))
        self.assertEqual(len(kept), 500)
        self.assertEqual(kept[-1], "id519")

    def test_a_spool_the_watch_renamed_aside_is_made_again(self):
        run = FakeRun((0, peek_output(("pepys", "a1", "one"))), (0, peek_output(("pepys", "a1", "one"), ("pepys", "a2", "two"))))
        p = self.poller(run)
        p.poll(now=0)
        self.spool.rename(self.spool.with_name(".watch-drain-lelle-spool.txt-1-1"))
        p.poll(now=30)
        self.assertEqual(self.lines(), ["from=pepys id=a2 subject=two"])

    def test_a_line_never_holds_a_line_break(self):
        p = self.poller(FakeRun((0, "collected 1\nid=7 text=a\rb\n")), match=r"id=(?P<id>\d+) text=(?P<t>.*)", line="{t}")
        p.poll(now=0)
        self.assertEqual(self.lines(), ["a b"])

    def test_the_child_reads_and_writes_utf8(self):
        run = FakeRun((0, peek_output(("pepys", "ä1", "Tšau"))))
        self.poller(run).poll(now=0)
        self.assertEqual(self.lines(), ["from=pepys id=ä1 subject=Tšau"])
        kw = run.calls[0][1]
        self.assertEqual((kw["encoding"], kw["env"]["PYTHONIOENCODING"]), ("utf-8", "utf-8"))


class Health(Folder):
    def test_failures_after_the_tolerance_are_one_line_then_at_most_one_per_interval_then_recovered(self):
        run = FakeRun(*([(1, "")] * 8), (0, peek_output()))
        p = self.poller(run, tolerate=3, health_every=1800)
        for t in range(0, 8 * 30, 30):
            p.poll(now=t)
        self.assertEqual(self.lines(), ["health: exit 1: boom"])
        p = self.poller(FakeRun(*([(1, "")] * 3), (1, ""), (0, peek_output())), tolerate=3, health_every=60)
        self.spool.unlink()
        for t in (0, 30, 60, 130, 200):
            p.poll(now=t)
        self.assertEqual(self.lines(), ["health: exit 1: boom", "health: exit 1: boom", "health: recovered"])

    def test_a_flap_under_the_tolerance_writes_nothing(self):
        p = self.poller(FakeRun((1, ""), (1, ""), (0, peek_output())), tolerate=3)
        for t in (0, 30, 60):
            p.poll(now=t)
        self.assertEqual(self.lines(), [])

    def test_unhealthy_output_a_timeout_and_a_missing_command_are_failures(self):
        for answer, why in [
            ((0, "Traceback: no route\n"), "output did not match ^collected"),
            (subprocess.TimeoutExpired(["x"], 90), "timed out after 90 s"),
            (FileNotFoundError(2, "No such file"), "cannot run evr-mail"),
        ]:
            with self.subTest(why=why):
                if self.spool.exists():
                    self.spool.unlink()
                p = self.poller(FakeRun(answer), tolerate=1)
                p.poll(now=0)
                self.assertEqual(len(self.lines()), 1)
                self.assertIn(why, self.lines()[0])
                self.assertTrue(self.lines()[0].startswith("health: "))


class Lock(Folder):
    def test_one_poller_per_spool(self):
        self.spool.parent.mkdir(parents=True)
        first = sp.take_lock(sp.lock_path(self.spool))
        self.assertIsNotNone(first)
        self.assertIsNone(sp.take_lock(sp.lock_path(self.spool)))
        first.close()
        again = sp.take_lock(sp.lock_path(self.spool))
        self.assertIsNotNone(again)
        again.close()

    def test_the_lock_and_log_sit_beside_the_spool_under_the_households_names(self):
        self.assertEqual(sp.lock_path(self.spool).name, ".lelle-spool.lock")
        self.assertEqual(sp.log_path(self.spool).name, ".lelle-spool.log")
        self.assertEqual(sp.seen_path(self.spool).name, ".lelle-spool-seen.json")


class Usage(unittest.TestCase):
    def test_bad_usage_exits_2_and_names_the_problem(self):
        for argv in ([], ["--spool", "x"], ["--spool", "x", "--match", "id=(?P<id>.)"], ["--spool", "x", "--match", "(", "--", "true"],
                     ["--spool", "x", "--json", "--match", "id=(?P<id>.)", "--", "true"], ["--spool", "x", "--", "true"],
                     ["--spool", "x", "--json", "--remind", "soon", "--", "true"], ["--status"]):
            with self.subTest(argv=argv), redirect_stderr(io.StringIO()) as err:
                self.assertEqual(sp.main(argv), 2)
                self.assertIn("usage: spool-poll.py", err.getvalue())

    def test_status_needs_the_spool_alone_and_json_replaces_match(self):
        self.assertEqual(sp.parse(["--status", "--spool", "x"])[0], "status")
        mode, config = sp.parse(["--spool", "x", "--json", "--remind", "15", "--deposited", "{deposited_at}", "--", "evr-mail", "recv", "--peek", "--json"])
        self.assertEqual((mode, config.match, config.json_items, config.remind, config.deposited), ("loop", None, True, 15.0, "{deposited_at}"))
        self.assertEqual(sp.parse(["--spool", "x", "--match", "id=(?P<id>.)", "--", "true"])[1].deposited, "{deposited}")


# What `evr-mail recv --peek --json` prints (hr2's poller reads it): the consignments as a JSON
# list, then the same tail lines as the text form. Kit #39.
def json_peek(*consignments):
    tail = f"collected {len(consignments)} (oldest 00:16:00)\n(--peek: not acking; custody stays with the hub)\n"
    return json.dumps(list(consignments), indent=2, ensure_ascii=False) + "\n" + (tail if consignments else "collected 0 -- nothing waiting\n")


def consignment(env_id, sender="pepys", summary="Hello", deposited="2026-10-15T13:50:00Z"):
    return {"id": env_id, "from_team": sender, "deposited_at": deposited, "entry": {"summary": summary, "text": "body"}}


JSON_LINE = "from={from_team} id={id} subject={entry[summary]}"
T0 = 1_792_072_200.0  # 2026-10-15T13:50:00Z, a wall clock for the reminder and the heartbeat
MINUTE = 60.0


class WindowsFlags(Folder):
    """Kit #39 (desk, framework-research): DETACHED_PROCESS flashed a console every poll on Windows;
    CREATE_NO_WINDOW fixed it. This box is not Windows: the flags passed are what is checked."""

    def test_the_peek_runs_with_create_no_window_on_windows_and_with_no_flags_elsewhere(self):
        run = FakeRun((0, peek_output()))
        with mock.patch.object(sp, "WINDOWS", True):
            self.poller(run).poll(now=0)
        self.assertEqual(run.calls[0][1]["creationflags"], sp.CREATE_NO_WINDOW)
        self.assertEqual(sp.CREATE_NO_WINDOW, 0x08000000)
        run = FakeRun((0, peek_output()))
        with mock.patch.object(sp, "WINDOWS", False):
            self.poller(run).poll(now=0)
        self.assertNotIn("creationflags", run.calls[0][1])

    def keep_alive_popen(self, windows, fail_first=False):
        popen = mock.Mock(side_effect=[OSError("breakaway refused"), mock.Mock()] if fail_first else None)
        argv = ["--keep-alive", "--spool", str(self.spool), "--match", LELLE_MATCH, "--", "true"]
        mode, config = sp.parse(argv)
        with mock.patch.object(sp, "WINDOWS", windows), mock.patch.object(sp.subprocess, "Popen", popen):
            self.assertEqual(sp.keep_alive(argv, config), 0)
        return popen

    def test_keep_alive_on_windows_starts_the_poller_with_no_window_never_detached_process(self):
        popen = self.keep_alive_popen(windows=True)
        flags = popen.call_args.kwargs["creationflags"]
        self.assertEqual(flags, sp.CREATE_NO_WINDOW | sp.CREATE_NEW_PROCESS_GROUP | sp.CREATE_BREAKAWAY_FROM_JOB)
        self.assertEqual(flags & 0x00000008, 0)  # DETACHED_PROCESS: the console flash
        self.assertNotIn("start_new_session", popen.call_args.kwargs)

    def test_keep_alive_on_windows_where_the_job_refuses_breakaway_still_has_no_window(self):
        popen = self.keep_alive_popen(windows=True, fail_first=True)
        self.assertEqual(popen.call_count, 2)
        self.assertEqual(popen.call_args.kwargs["creationflags"], sp.CREATE_NO_WINDOW | sp.CREATE_NEW_PROCESS_GROUP)

    def test_keep_alive_on_posix_is_its_own_session_and_passes_no_flags(self):
        popen = self.keep_alive_popen(windows=False)
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        self.assertNotIn("creationflags", popen.call_args.kwargs)


class Heartbeat(Folder):
    """Kit #39: a dead poller was silent (four seats); FR could not date an outage. Each successful
    poll stamps .<stem>.alive beside the spool; --status and --keep-alive read it."""

    def alive(self):
        return sp.alive_path(self.spool).read_text(encoding="utf-8")

    def status(self, *extra):
        out = io.StringIO()
        with redirect_stdout(out):
            code = sp.main(["--status", "--spool", str(self.spool), *extra])
        return code, out.getvalue()

    def test_a_successful_poll_stamps_the_heartbeat_and_a_failed_one_does_not(self):
        self.assertEqual(sp.alive_path(self.spool).name, ".lelle-spool.alive")
        p = self.poller(FakeRun((0, peek_output()), (1, "")), every=30, timeout=90)
        p.poll(now=0, wall=T0)
        self.assertEqual(self.alive(), f"{sp.stamp(T0)} pid={os.getpid()} every=30 timeout=90\n")
        self.assertEqual(sp.stamp(T0), "2026-10-15T13:50:00Z")
        p.poll(now=30, wall=T0 + 30)
        self.assertEqual(self.alive(), f"{sp.stamp(T0)} pid={os.getpid()} every=30 timeout=90\n")

    def test_status_with_no_poller_and_no_heartbeat_says_so_exit_1(self):
        code, out = self.status()
        self.assertEqual(code, 1)
        self.assertIn("poller: not running", out)
        self.assertIn("last successful poll: none recorded", out)

    def test_status_with_a_running_poller_and_a_fresh_heartbeat_exit_0(self):
        self.poller(FakeRun((0, peek_output()))).poll(now=0, wall=T0)
        held = sp.take_lock(sp.lock_path(self.spool))
        held.write("4242\n")
        held.flush()
        try:
            with mock.patch.object(sp.time, "time", return_value=T0 + 40):
                code, out = self.status()
        finally:
            held.close()
        self.assertEqual(code, 0, out)
        self.assertIn("poller: running, pid 4242", out)
        self.assertIn("last successful poll: 2026-10-15T13:50:00Z, 40 s ago", out)
        self.assertNotIn("stale", out)

    def test_status_with_a_stale_heartbeat_says_stale_exit_1(self):
        # Stale: older than two intervals and a timeout (30 s, 90 s: 150 s), the poller's own figures.
        self.poller(FakeRun((0, peek_output())), every=30, timeout=90).poll(now=0, wall=T0)
        held = sp.take_lock(sp.lock_path(self.spool))
        try:
            with mock.patch.object(sp.time, "time", return_value=T0 + 151):
                code, out = self.status()
        finally:
            held.close()
        self.assertEqual(code, 1, out)
        self.assertIn("stale: no successful poll for 151 s (more than 150 s)", out)

    def test_keep_alive_reports_a_running_poller_whose_heartbeat_is_stale_and_starts_nothing(self):
        self.poller(FakeRun((0, peek_output()))).poll(now=0, wall=T0)
        held = sp.take_lock(sp.lock_path(self.spool))
        held.write("4242\n")
        held.flush()
        argv = ["--keep-alive", "--spool", str(self.spool), "--match", LELLE_MATCH, "--", "true"]
        popen, out = mock.Mock(), io.StringIO()
        try:
            for when, says in ((T0 + 60, ""), (T0 + 600, "stale")):
                out.truncate(0)
                with redirect_stdout(out), mock.patch.object(sp.time, "time", return_value=when), mock.patch.object(sp.subprocess, "Popen", popen):
                    self.assertEqual(sp.main(argv), 0)
                if says:
                    self.assertIn("spool-poll: the poller (pid 4242) holds the lock, but its last successful poll was 10 min ago (2026-10-15T13:50:00Z)", out.getvalue())
                else:
                    self.assertEqual(out.getvalue(), "")
        finally:
            held.close()
        popen.assert_not_called()

    def test_keep_alive_starting_a_poller_after_an_outage_dates_it(self):
        self.poller(FakeRun((0, peek_output()))).poll(now=0, wall=T0)
        argv = ["--keep-alive", "--spool", str(self.spool), "--match", LELLE_MATCH, "--", "true"]
        out = io.StringIO()
        with redirect_stdout(out), mock.patch.object(sp.time, "time", return_value=T0 + 2 * 3600), mock.patch.object(sp.subprocess, "Popen", mock.Mock()):
            self.assertEqual(sp.main(argv), 0)
        self.assertIn("spool-poll: no poller was running; the last successful poll was 2 h ago (2026-10-15T13:50:00Z); started one", out.getvalue())


class Reminder(Folder):
    """Kit #39 (semafor): a delivered id was announced once; a session that never ran recv heard
    nothing again. With --remind N, an id still in the peek N minutes after this poller first saw
    it gets one `waiting:` line, its age from the hub's deposited stamp when the peek carries one."""

    MATCH = LELLE_MATCH.replace(r"id=(?P<id>\S+)", r"id=(?P<id>\S+)(?:\s+deposited=(?P<deposited>\S+))?")

    def test_one_waiting_line_after_n_minutes_its_age_from_deposited(self):
        out = "collected 1\n--- 1/1  from=pepys  id=a1  deposited=2026-10-15T13:45:00Z\nsubject: Hello\n"
        p = self.poller(FakeRun((0, out)), match=self.MATCH, remind=15)
        for minute in (0, 14, 15, 16, 45):
            p.poll(now=minute * MINUTE, wall=T0 + minute * MINUTE)
        self.assertEqual(self.lines(), ["from=pepys id=a1 subject=Hello", "waiting: id=a1 age=20m -- from=pepys id=a1 subject=Hello"])

    def test_without_a_stamp_the_age_counts_from_when_this_poller_first_saw_it(self):
        p = self.poller(FakeRun((0, peek_output(("pepys", "a1", "Hello")))), remind=15)
        for minute in (0, 15, 90):
            p.poll(now=minute * MINUTE, wall=T0 + minute * MINUTE)
        self.assertEqual(self.lines(), ["from=pepys id=a1 subject=Hello", "waiting: id=a1 age=15m -- from=pepys id=a1 subject=Hello"])

    def test_a_collected_id_is_not_reminded_and_off_by_default(self):
        p = self.poller(FakeRun((0, peek_output(("pepys", "a1", "Hello"))), (0, peek_output())), remind=15)
        for minute in (0, 1, 30):
            p.poll(now=minute * MINUTE, wall=T0 + minute * MINUTE)
        self.assertEqual(self.lines(), ["from=pepys id=a1 subject=Hello"])
        self.spool.unlink()
        p = self.poller(FakeRun((0, peek_output(("pepys", "b2", "Two")))))
        for minute in (0, 60, 600):
            p.poll(now=minute * MINUTE, wall=T0 + minute * MINUTE)
        self.assertEqual(self.lines(), ["from=pepys id=b2 subject=Two"])

    def test_ages_in_hours(self):
        self.assertEqual([sp.age_of(s) for s in (59, 60, 17 * 60 + 5, 3600, 2 * 3600 + 5 * 60)], ["0m", "1m", "17m", "1h00m", "2h05m"])


class JsonInput(Folder):
    """Kit #39 (hr2): `recv --peek --json` instead of a regex over text, which breaks quietly on a
    format change and gets long subjects cut. --json reads the first JSON value of the output."""

    def poller_json(self, run, **kw):
        args = dict(match=None, json_items=True, line=JSON_LINE, healthy=None)
        args.update(kw)
        return self.poller(run, **args)

    def test_each_object_is_an_item_keyed_by_id_written_by_the_template_with_index_access(self):
        long = "A subject far longer than the text peek would show " * 3
        run = FakeRun((0, json_peek(consignment("a1"), consignment("b2", "hr2", long.strip()))))
        self.poller_json(run).poll(now=0)
        self.assertEqual(self.lines(), ["from=pepys id=a1 subject=Hello", f"from=hr2 id=b2 subject={long.strip()}"])

    def test_a_missing_field_is_empty_and_without_line_the_item_is_its_json_on_one_line(self):
        self.poller_json(FakeRun((0, json_peek({"id": "c3", "from_team": "x"})))).poll(now=0)
        self.assertEqual(self.lines(), ["from=x id=c3 subject="])
        self.spool.unlink()
        self.poller_json(FakeRun((0, json_peek({"id": "d4", "n": 1}))), line=None).poll(now=0)
        self.assertEqual(self.lines(), ['{"id": "d4", "n": 1}'])

    def test_an_empty_list_is_healthy_and_spools_nothing(self):
        p = self.poller_json(FakeRun((0, json_peek())), tolerate=1)
        p.poll(now=0, wall=T0)
        self.assertEqual(self.lines(), [])
        self.assertTrue(sp.alive_path(self.spool).exists())

    def test_output_that_is_not_a_json_list_of_objects_with_ids_is_a_failure(self):
        for out, why in [
            ("collected 1\n--- 1/1 from=x id=z\n", "output is not JSON"),
            ('{"id": "z"}\n', "output is not a JSON list"),
            ('[{"from_team": "x"}]\n', "item 1 has no id"),
            ('["z"]\n', "item 1 is not an object"),
        ]:
            with self.subTest(why=why):
                if self.spool.exists():
                    self.spool.unlink()
                self.poller_json(FakeRun((0, out)), tolerate=1).poll(now=0)
                self.assertEqual(len(self.lines()), 1, self.lines())
                self.assertTrue(self.lines()[0].startswith(f"health: {why}"), self.lines())

    def test_the_reminder_reads_deposited_through_its_template(self):
        run = FakeRun((0, json_peek(consignment("a1", deposited="2026-10-15T13:40:00Z"))))
        p = self.poller_json(run, remind=15, deposited="{deposited_at}")
        for minute in (0, 15):
            p.poll(now=minute * MINUTE, wall=T0 + minute * MINUTE)
        self.assertEqual(self.lines()[-1], "waiting: id=a1 age=25m -- from=pepys id=a1 subject=Hello")


FAKE_PEEK = textwrap.dedent("""\
    print("collected 1")
    print("--- 1/1 from=pepys id=k1")
    print("subject: kept alive")
    """)


@unittest.skipIf(os.name == "nt", "the live keep-alive test runs on POSIX; Windows is unverified")
class KeepAlive(Folder):
    """A real detached poller, started by --keep-alive as a SessionStart hook would, then stopped."""

    def setUp(self):
        super().setUp()
        self.fake = self.dir / "fake-peek.py"
        self.fake.write_text(FAKE_PEEK, encoding="utf-8")
        self.argv = ["--spool", str(self.spool), "--match", LELLE_MATCH, "--line", LELLE_LINE, "--every", "0.2", "--", sys.executable, str(self.fake)]

    def tearDown(self):
        # Every poller this test started names its temporary folder: stop them all, even more than
        # one (a broken lock).
        subprocess.run(["pkill", "-f", f"spool-poll.py --spool {self.dir}"], check=False)
        lock = sp.lock_path(self.spool)
        try:
            pid = int(lock.read_text(encoding="utf-8").strip())
            os.kill(pid, signal.SIGTERM)
            for _ in range(50):
                os.kill(pid, 0)
                time.sleep(0.05)
        except (OSError, ValueError):
            pass
        super().tearDown()

    def wait_for(self, check, seconds=10):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if check():
                return True
            time.sleep(0.05)
        return False

    def test_keep_alive_starts_one_detached_poller_and_returns_at_once(self):
        started = time.monotonic()
        self.assertEqual(subprocess.run([sys.executable, str(HERE / "spool-poll.py"), "--keep-alive", *self.argv], timeout=10).returncode, 0)
        self.assertLess(time.monotonic() - started, 5)
        self.assertTrue(self.wait_for(lambda: self.lines() == ["from=pepys id=k1 subject=kept alive"]))
        pid = int(sp.lock_path(self.spool).read_text(encoding="utf-8").strip())
        # A second session start finds it running: nothing new is started.
        self.assertEqual(subprocess.run([sys.executable, str(HERE / "spool-poll.py"), "--keep-alive", *self.argv], timeout=10).returncode, 0)
        time.sleep(0.6)
        self.assertEqual(int(sp.lock_path(self.spool).read_text(encoding="utf-8").strip()), pid)
        self.assertNotIn("another poller", sp.log_path(self.spool).read_text(encoding="utf-8"))
        # Its own session: a signal to the starter's process group does not reach it.
        self.assertNotEqual(os.getpgid(pid), os.getpgid(0))

    def test_a_live_poller_stamps_its_heartbeat_and_status_says_running_and_fresh(self):
        script = [sys.executable, str(HERE / "spool-poll.py")]
        self.assertEqual(subprocess.run([*script, "--status", "--spool", str(self.spool)], capture_output=True, timeout=10).returncode, 1)
        subprocess.run([*script, "--keep-alive", *self.argv], timeout=10)
        self.assertTrue(self.wait_for(lambda: sp.alive_path(self.spool).exists()))
        r = subprocess.run([*script, "--status", "--spool", str(self.spool)], capture_output=True, text=True, timeout=10)
        self.assertEqual(r.returncode, 0, r.stdout)
        pid = sp.lock_path(self.spool).read_text(encoding="utf-8").strip()
        self.assertIn(f"poller: running, pid {pid}", r.stdout)
        self.assertIn(f"pid={pid} every=0.2 timeout=90", sp.alive_path(self.spool).read_text(encoding="utf-8"))

    def test_a_poller_started_by_hand_while_one_runs_exits_0_and_says_so(self):
        subprocess.run([sys.executable, str(HERE / "spool-poll.py"), "--keep-alive", *self.argv], timeout=10)
        self.assertTrue(self.wait_for(lambda: sp.lock_path(self.spool).exists() and sp.lock_path(self.spool).read_text(encoding="utf-8").strip() != ""))
        r = subprocess.run([sys.executable, str(HERE / "spool-poll.py"), *self.argv], capture_output=True, text=True, timeout=10)
        self.assertEqual(r.returncode, 0)
        self.assertIn("another poller holds", r.stdout)


if __name__ == "__main__":
    unittest.main()
