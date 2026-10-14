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
from contextlib import redirect_stderr

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
        for argv in ([], ["--spool", "x"], ["--spool", "x", "--match", "id=(?P<id>.)"], ["--spool", "x", "--match", "(", "--", "true"]):
            with self.subTest(argv=argv), redirect_stderr(io.StringIO()) as err:
                self.assertEqual(sp.main(argv), 2)
                self.assertIn("usage: spool-poll.py", err.getvalue())


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

    def test_a_poller_started_by_hand_while_one_runs_exits_0_and_says_so(self):
        subprocess.run([sys.executable, str(HERE / "spool-poll.py"), "--keep-alive", *self.argv], timeout=10)
        self.assertTrue(self.wait_for(lambda: sp.lock_path(self.spool).exists() and sp.lock_path(self.spool).read_text(encoding="utf-8").strip() != ""))
        r = subprocess.run([sys.executable, str(HERE / "spool-poll.py"), *self.argv], capture_output=True, text=True, timeout=10)
        self.assertEqual(r.returncode, 0)
        self.assertIn("another poller holds", r.stdout)


if __name__ == "__main__":
    unittest.main()
