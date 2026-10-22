#!/usr/bin/env python3
"""Tests for tools/kit-update.py: the stdlib alone (unittest), no network, no git.

    python3 tools/kit-update-test.py

git and the lint run through subprocess.run, which a fake replaces: it answers each command the
tool runs from a small table and records what it was given. Ultrareview of main at
v0.1.0-alpha.13, findings 1, 4 and 5.
"""
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

# Loading kit-update.py must leave nothing behind in tools/ (no __pycache__).
sys.dont_write_bytecode = True
HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("kit_update", HERE / "kit-update.py")
ku = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ku)

spec_due = importlib.util.spec_from_file_location("obligations_due", HERE / "obligations-due.py")
due = importlib.util.module_from_spec(spec_due)
spec_due.loader.exec_module(due)
sys.path.insert(0, str(HERE.parent / "lint"))
import kit_home  # noqa: E402  (lint/kit_home.py: the one Python copy of the kit_home rules)

UPGRADE = """## Per version
- **0.1.0-alpha.11 -> 0.1.0-alpha.12:** no data step. Pull, lint.
- **0.1.0-alpha.12 -> 0.1.0-alpha.13:** no data step. Pull, lint.
- **0.1.0-alpha.13 -> 0.1.0-alpha.14:** no data step. Pull, lint.
"""


class FakeHost:
    """subprocess.run for the tool: git and the lint answered from a table, every call recorded."""

    def __init__(self, tags, upgrade=UPGRADE, pull="ok", fetch="ok", status="", diff="", lint="pass",
                 abort_rc=0, keep_rc=0, installed=(), claude_rc=None, claude_real=False, nested=None, repo=True):
        self.tags, self.upgrade, self.pull, self.fetch = tags, upgrade, pull, fetch
        # The pull: "ok" commits; "conflict" and "hook" (a commit hook refusing the subject) leave a
        # merge in progress with its changes staged, as git does; "refused" fails before merging;
        # "hang" times out with nothing changed, "hang-dirty" with a staged change left behind.
        # The lint gate: "pass", or "fail" on the pulled tree only. The undo's two steps fail when
        # their rc is not 0 (kit #24). The repo's state: HEAD, a merge in progress, the pull's
        # own changes.
        self.lint, self.abort_rc, self.keep_rc = lint, abort_rc, keep_rc
        self.head, self.merging, self.left = "start123", False, []
        # Kit #49: the home's path from the top of its repo ("teams/apex"), None for a home at the
        # top; and whether the home is in a git work tree at all.
        self.nested, self.repo = nested, repo
        # `claude` (kit #37): the plugins `claude plugin list --json` shows as installed, an exit
        # code per subcommand ("list", "marketplace", "update <plugin>", default 0), and whether
        # a claude call runs for real (the fake `claude` a test put on PATH).
        self.installed, self.claude_rc, self.claude_real = list(installed), dict(claude_rc or {}), claude_real
        # `git status --porcelain` as the home would answer it with every untracked file shown, each
        # path from the top of the repo as git gives it; the fake applies the flags and the pathspec
        # the tool passes (a pathspec counts from the folder git runs in, as in git).
        self.status = status
        self.diff = diff  # `git diff --name-only` between the start and the pulled commit, from the top
        self.calls = []

    def __call__(self, argv, **kw):
        self.calls.append((list(argv), kw))
        done = lambda rc=0, out="", err="": subprocess.CompletedProcess(argv, rc, out, err)
        words = [a for a in argv if not a.startswith("-") and a != "git"]
        if pathlib.Path(argv[0]).name == "claude":
            return self.claude(argv, kw, done)
        if "ls-remote" in argv:
            return done(out="".join(f"abc\trefs/tags/{t}\n" for t in self.tags))
        if argv[0] == "bash":  # the lint gate
            if self.lint == "fail" and self.head != "start123":
                return done(rc=1, out="  FAIL rules.yaml: a check the new version added\n")
            return done()
        cmd = argv[3] if argv[:2] == ["git", "-C"] else words[0]
        if argv[:2] == ["git", "-C"] and not self.repo:
            return done(rc=128, err="fatal: not a git repository (or any of the parent directories): .git")
        top, here = self.where(argv[2]) if argv[:2] == ["git", "-C"] else ("", "")
        if cmd == "status":
            lines = self.status.splitlines() + self.left
            if "--untracked-files=no" in argv:
                lines = [l for l in lines if not l.startswith("??")]
            if "--" in argv:
                prefix = here + argv[argv.index("--") + 1].rstrip("/") + "/"
                lines = [l for l in lines if l[3:].startswith(prefix)]
            return done(out="".join(l + "\n" for l in lines))
        if cmd == "fetch":
            if self.fetch == "hang":
                raise subprocess.TimeoutExpired(argv, kw.get("timeout"))
            return done()
        if cmd == "show":
            return done(out=self.upgrade)
        if cmd == "rev-parse":
            if "--show-toplevel" in argv:
                return done(out=f"{top}\n{here}\n")
            if "MERGE_HEAD" in argv:
                return done(out="merge789\n") if self.merging else done(rc=1)
            return done(out=self.head + "\n")
        if cmd == "subtree":
            if here:  # git subtree's own refusal below the top (kit #49)
                return done(rc=1, err="You need to run this command from the toplevel of the working tree.")
            kit = [a for a in argv if a.startswith("--prefix=")][0][len("--prefix="):]
            if self.pull in ("hang", "hang-dirty"):
                self.left = [f"M  {kit}/VERSION"] if self.pull == "hang-dirty" else []
                raise subprocess.TimeoutExpired(argv, kw.get("timeout"))
            if self.pull == "ok":
                self.head = "pulled456"
                return done()
            if self.pull == "refused":
                return done(rc=1, err="fatal: working tree has modifications.  Cannot add.")
            self.merging, self.left = True, [f"UU {kit}/VERSION", f"A  {kit}/adapters/claude-code/watch/x.ts"]
            return done(rc=1, err="CONFLICT (content): Merge conflict in VERSION" if self.pull == "conflict"
                        else "need a story ref\nNot committing merge; use 'git commit' to complete the merge.")
        if cmd == "merge" and "--abort" in argv:
            if not self.merging:
                return done(rc=128, err="fatal: There is no merge to abort (MERGE_HEAD missing).")
            if self.abort_rc:
                return done(rc=self.abort_rc, err="fatal: Unable to create '.git/index.lock': File exists.")
            self.merging, self.left = False, []
            return done()
        if cmd == "reset":
            mode, to = argv[4], argv[5]
            if mode == "--keep" and self.merging:
                return done(rc=128, err="fatal: Cannot do a keep reset in the middle of a merge.")
            if mode == "--keep" and self.keep_rc:
                return done(rc=self.keep_rc, err="error: Entry 'memory-kit/VERSION' not uptodate. Cannot merge.")
            self.head, self.merging, self.left = to, False, []  # --hard too, as git: the tests forbid it
            return done()
        if cmd == "diff":
            prefix, end = here + argv[argv.index("--") + 1].rstrip("/") + "/", "\0" if "-z" in argv else "\n"
            return done(out="".join(l + end for l in self.diff.splitlines() if l.startswith(prefix)))
        raise AssertionError(f"unexpected command: {argv}")

    def git_calls(self, cmd):
        return [argv[3:] for argv, kw in self.calls if argv[:2] == ["git", "-C"] and argv[3] == cmd]

    def where(self, cwd):
        """(the top of the repo, the folder's path from it with a trailing /), as git rev-parse
        --show-toplevel --show-prefix answers them for a folder git runs in."""
        p, parts = pathlib.Path(cwd), tuple(self.nested.split("/")) if self.nested else ()
        if parts and p.parts[-len(parts):] == parts:
            return str(p.parents[len(parts) - 1]), self.nested + "/"
        return str(p), ""

    def claude(self, argv, kw, done):
        if self.claude_real:
            return REAL_RUN(argv, **kw)
        sub = argv[2] if argv[2] != "update" else f"update {argv[3]}"
        rc = self.claude_rc.get(sub, 0)
        if sub == "list":
            listing = [{"id": f"{p}@memory-kit", "version": "0.1.0", "scope": "user"} for p in self.installed]
            listing.append({"id": "context7@claude-plugins-official", "version": "1", "scope": "user"})
            return done(rc=rc, out=json.dumps(listing) if rc == 0 else "", err="" if rc == 0 else "list failed")
        if sub == "marketplace" and rc == "hang":
            raise subprocess.TimeoutExpired(argv, kw.get("timeout"))
        return done(rc=rc, out="ok\n" if rc == 0 else "", err="" if rc == 0 else f"{sub} failed")

    def claude_calls(self):
        return [argv for argv, kw in self.calls if pathlib.Path(argv[0]).name == "claude"]

    def timeout_of(self, cmd):
        return [kw.get("timeout") for argv, kw in self.calls if argv[:2] == ["git", "-C"] and argv[3] == cmd]


REAL_RUN = subprocess.run
# A fake `claude` for PATH (kit #37): the tests never run the real one. It records its arguments
# and working folder, one line per call, in claude-calls.txt beside it. Shell builtins only: PATH
# holds nothing but its own folder.
FAKE_CLAUDE = """#!/bin/sh
printf '%s|%s\\n' "$(pwd)" "$*" >> '{log}'
case "$*" in
  "plugin list --json") echo '[{"id": "watch@memory-kit", "version": "0.3.1", "scope": "project"}]' ;;
  *) echo ok ;;
esac
"""


def bin_dir(root, claude):
    """A folder for PATH: with the fake `claude` in it, or empty (claude not on PATH)."""
    d = pathlib.Path(root) / "bin"
    d.mkdir()
    if claude:
        (d / "claude").write_text(FAKE_CLAUDE.replace("{log}", str(d / "claude-calls.txt")), encoding="utf-8")
        (d / "claude").chmod(0o755)
    return d


def run_tool(host, current="0.1.0-alpha.13", channel="latest", claude=False, home_out=None, home_rel="home", conf=""):
    """The tool over a fresh home, `host` standing for subprocess.run, PATH holding only a test
    folder: with the fake `claude` (claude=True) or without one, never the real one. The home is
    `home_rel` in a temporary folder; `conf`, more lines for its memory-kit.conf."""
    with tempfile.TemporaryDirectory() as d:
        home = pathlib.Path(d) / home_rel
        (home / "memory-kit").mkdir(parents=True)
        (home / "memory-kit" / "VERSION").write_text(current + "\n", encoding="utf-8")
        (home / "memory-kit.conf").write_text(f"update: {channel}\n{conf}", encoding="utf-8")
        path = bin_dir(d, claude)
        real, ku.subprocess.run = ku.subprocess.run, host
        out = io.StringIO()
        try:
            with redirect_stdout(out), mock.patch.dict(os.environ, {"PATH": str(path)}):
                code = ku.main(["kit-update.py", str(home)])
        finally:
            ku.subprocess.run = real
        if home_out is not None:
            home_out.update(home=home, calls=(path / "claude-calls.txt").read_text(encoding="utf-8")
                            if (path / "claude-calls.txt").exists() else "")
        return code, out.getvalue()


class Finding1CurrentVersionAlwaysOnThePath(unittest.TestCase):
    def test_the_path_starts_at_the_current_version_even_when_its_tag_is_gone(self):
        releases = ["v0.1.0-alpha.12", "v0.1.0-alpha.14"]  # v0.1.0-alpha.13 deleted upstream
        self.assertEqual(ku.step_path("0.1.0-alpha.13", releases, "v0.1.0-alpha.14"), ["0.1.0-alpha.13", "0.1.0-alpha.14"])
        self.assertEqual(
            ku.step_path("0.1.0-alpha.12", ["v0.1.0-alpha.12", "v0.1.0-alpha.13", "v0.1.0-alpha.14"], "v0.1.0-alpha.14"),
            ["0.1.0-alpha.12", "0.1.0-alpha.13", "0.1.0-alpha.14"],
        )

    def test_a_missing_entry_for_the_current_hop_refuses(self):
        md = "- **0.1.0-alpha.12 -> 0.1.0-alpha.14:** no data step.\n"
        path = ku.step_path("0.1.0-alpha.13", ["v0.1.0-alpha.12", "v0.1.0-alpha.14"], "v0.1.0-alpha.14")
        self.assertEqual(ku.data_steps_ok(md, path), "UPGRADE.md has no entry for 0.1.0-alpha.13 -> 0.1.0-alpha.14")

    def test_end_to_end_a_gone_current_tag_and_no_entry_is_refused_before_any_pull(self):
        host = FakeHost(tags=["v0.1.0-alpha.12", "v0.1.0-alpha.14"], upgrade="- **0.1.0-alpha.12 -> 0.1.0-alpha.14:** no data step.\n")
        code, out = run_tool(host)
        self.assertEqual(code, 1)
        self.assertIn("refused: UPGRADE.md has no entry for 0.1.0-alpha.13 -> 0.1.0-alpha.14", out)
        self.assertEqual(host.timeout_of("subtree"), [])


class Finding4ARollbackThatFailsIsSaidPlainly(unittest.TestCase):
    def test_a_failed_pull_whose_undo_works_is_undone_exit_1(self):
        code, out = run_tool(FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"], pull="conflict"))
        self.assertEqual(code, 1)
        self.assertIn("subtree pull failed: CONFLICT (content): Merge conflict in VERSION; the pull is undone (back to start123)", out)

    def test_a_failed_pull_whose_undo_fails_says_so_and_exits_3(self):
        code, out = run_tool(FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"], pull="conflict", abort_rc=128))
        self.assertEqual(code, ku.EXIT_ROLLBACK_FAILED)
        self.assertEqual(ku.EXIT_ROLLBACK_FAILED, 3)
        self.assertNotIn("undone", out)
        self.assertIn("may be partly pulled", out)
        self.assertIn("git merge --abort said: fatal: Unable to create '.git/index.lock'", out)
        self.assertIn("still changed: memory-kit/VERSION, memory-kit/adapters/claude-code/watch/x.ts", out)
        self.assertIn("merge --abort` (if a merge is in progress)", out)
        self.assertIn("reset --keep start123`", out)
        self.assertIn("index.lock", out)
        self.assertNotIn("--hard", out)


class Finding5NetworkCallsAreBounded(unittest.TestCase):
    def test_fetch_and_subtree_pull_carry_the_timeout(self):
        host = FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"])
        code, out = run_tool(host)
        self.assertEqual(code, 0, out)
        self.assertEqual(host.timeout_of("fetch"), [ku.NETWORK_TIMEOUT])
        self.assertEqual(host.timeout_of("subtree"), [ku.NETWORK_TIMEOUT])
        self.assertEqual(ku.NETWORK_TIMEOUT, 300)

    def test_a_pull_that_times_out_is_a_failure_and_its_state_checked(self):
        host = FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"], pull="hang")
        code, out = run_tool(host)
        self.assertEqual(code, 1)
        self.assertIn("timed out after 300 s; nothing changed (still at start123)", out)
        self.assertEqual(host.git_calls("rev-parse")[-2:], [["rev-parse", "HEAD"], ["rev-parse", "-q", "--verify", "MERGE_HEAD"]])

    def test_a_fetch_that_times_out_fails_cleanly_before_anything_changed(self):
        host = FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"], fetch="hang")
        code, out = run_tool(host)
        self.assertEqual(code, 1)
        self.assertIn("timed out after 300 s", out)
        self.assertEqual(host.timeout_of("subtree"), [])

    def test_git_never_waits_on_a_credential_prompt(self):
        host = FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"])
        run_tool(host)
        fetch_env = [kw.get("env") or {} for argv, kw in host.calls if "fetch" in argv][0]
        self.assertEqual(fetch_env.get("GIT_TERMINAL_PROMPT"), "0")


def tree(root, files):
    """Write {relative path: text} under root."""
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


class KitHomePointer(unittest.TestCase):
    """kit #18: memory-kit.conf `kit_home:` names the home; one hop, never chained."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_no_pointer_the_start_is_the_home(self):
        tree(self.root, {"start/memory-kit.conf": "memory_dir: memory\n"})
        r = kit_home.resolve(self.root / "start")
        self.assertEqual((r.home, r.pointer, r.problem), (self.root / "start", None, None))
        r = kit_home.resolve(self.root / "nothing-here")
        self.assertEqual((r.home, r.problem), (self.root / "nothing-here", None))

    def test_a_relative_pointer_is_relative_to_the_conf_folder(self):
        tree(self.root, {"start/memory-kit.conf": "kit_home: ../desk\n", "desk/memory-kit.conf": "memory_dir: memory\n"})
        r = kit_home.resolve(self.root / "start")
        self.assertEqual(r.home, self.root / "desk")
        self.assertEqual(r.pointer, self.root / "start" / "memory-kit.conf")
        self.assertIsNone(r.problem)

    def test_an_absolute_pointer_and_windows_paths_count_as_absolute(self):
        tree(self.root, {"start/memory-kit.conf": f"kit_home: '{self.root / 'desk'}'  # the desk\n", "desk/memory-kit.conf": ""})
        self.assertEqual(kit_home.resolve(self.root / "start").home, self.root / "desk")
        for p in ["/srv/home", "C:\\Users\\m\\.claude\\pepys", "C:/Users/m", "\\\\server\\share\\kit"]:
            self.assertTrue(kit_home.is_absolute(p), p)
        for p in ["desk", "../desk", "C:desk", "~/desk"]:
            self.assertFalse(kit_home.is_absolute(p), p)

    def test_a_target_without_a_conf_is_a_problem_not_a_silent_home(self):
        tree(self.root, {"start/memory-kit.conf": "kit_home: ../nowhere\n"})
        r = kit_home.resolve(self.root / "start")
        self.assertIsNone(r.home)
        self.assertIn("no memory-kit.conf", r.problem)
        self.assertIn(str(self.root / "nowhere"), r.problem)

    def test_followed_one_hop_never_chained_and_loops_refused(self):
        tree(self.root, {
            "a/memory-kit.conf": "kit_home: ../b\n",
            "b/memory-kit.conf": "kit_home: ../c\n",
            "c/memory-kit.conf": "memory_dir: memory\n",
        })
        r = kit_home.resolve(self.root / "a")
        self.assertIsNone(r.home)
        self.assertIn("one hop", r.problem)
        tree(self.root, {"b/memory-kit.conf": "kit_home: ../a\n"})
        self.assertIn("one hop", kit_home.resolve(self.root / "a").problem)

    def test_a_home_naming_itself_is_just_the_home(self):
        tree(self.root, {"desk/memory-kit.conf": "kit_home: .\nmemory_dir: memory\n"})
        r = kit_home.resolve(self.root / "desk")
        self.assertEqual((r.home, r.pointer, r.problem), (self.root / "desk", None, None))
        tree(self.root, {"start/memory-kit.conf": "kit_home: ../desk\n"})
        self.assertEqual(kit_home.resolve(self.root / "start").home, self.root / "desk")

    def test_tilde_is_refused_plainly(self):
        tree(self.root, {"start/memory-kit.conf": "kit_home: ~/desk\n"})
        self.assertIn("absolute or relative", kit_home.resolve(self.root / "start").problem)

    def test_other_keys_in_a_pointer_conf_are_reported_as_ignored(self):
        tree(self.root, {
            "start/memory-kit.conf": "# pointer\nkit_home: ../desk\nwatch_sources:\n  - a | lines | x\nmemory_dir: m\n",
            "desk/memory-kit.conf": "",
        })
        self.assertEqual(kit_home.resolve(self.root / "start").ignored, ["watch_sources", "memory_dir"])



class KitHomeKeyTwice(unittest.TestCase):
    """Kit #55: a memory-kit.conf that gives a top-level key twice is a problem, said plainly and
    worded as the plugins' hooks/kit-home.ts words it; never a silent pick. YAML kept the last
    copy and the line readers the first, so the lint and the pane read two memory directories."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def twice(self, conf, key, line, first):
        return f"{conf}: duplicate key '{key}' on line {line} (first on line {first}); the plugins would take the first and the lint the last, so keep only one"

    def test_in_the_start_folders_conf(self):
        tree(self.root, {"start/memory-kit.conf": "memory_dir: memory\nmode: gate\nmemory_dir: notes  # moved\n"})
        r = kit_home.resolve(self.root / "start")
        conf = self.root / "start" / "memory-kit.conf"
        self.assertEqual((r.home, r.pointer, r.problem), (None, conf, self.twice(conf, "memory_dir", 3, 1)))

    def test_in_the_conf_a_pointer_names(self):
        tree(self.root, {"start/memory-kit.conf": "kit_home: ../desk\n", "desk/memory-kit.conf": "update: pinned\n\nupdate: latest\n"})
        r = kit_home.resolve(self.root / "start")
        self.assertEqual((r.home, r.pointer), (None, self.root / "start" / "memory-kit.conf"))
        self.assertEqual(r.problem, self.twice(self.root / "desk" / "memory-kit.conf", "update", 3, 1))

    def test_kit_home_itself_twice(self):
        tree(self.root, {"start/memory-kit.conf": "kit_home: ../a\nkit_home: ../b\n", "a/memory-kit.conf": "", "b/memory-kit.conf": ""})
        conf = self.root / "start" / "memory-kit.conf"
        self.assertEqual(kit_home.resolve(self.root / "start").problem, self.twice(conf, "kit_home", 2, 1))

    def test_in_a_conf_found_above(self):
        tree(self.root, {"home/memory-kit.conf": "memory_dir: a\nmemory_dir: b\n", "home/sub/x": ""})
        r = kit_home.resolve(self.root / "home/sub", upward=True)
        self.assertEqual(r.problem, self.twice(self.root / "home" / "memory-kit.conf", "memory_dir", 2, 1))

    def test_a_key_repeated_inside_a_block_is_not_top_level(self):
        conf = 'watch_files:\n  - label: "a"\n    path: a.txt\n  - label: "b"\n    path: b.txt\n# memory_dir: old\nmemory_dir: memory\n'
        tree(self.root, {"start/memory-kit.conf": conf})
        r = kit_home.resolve(self.root / "start")
        self.assertEqual((r.home, r.problem), (self.root / "start", None))

    def test_kit_update_refuses_it_before_reading_the_channel(self):
        host = FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"])
        tree(self.root, {"desk/memory-kit.conf": "update: latest\nupdate: pinned\n", "desk/memory-kit/VERSION": "0.1.0-alpha.13\n"})
        real, ku.subprocess.run = ku.subprocess.run, host
        out = io.StringIO()
        try:
            with redirect_stdout(out):
                code = ku.main(["kit-update.py", str(self.root / "desk")])
        finally:
            ku.subprocess.run = real
        self.assertEqual(code, 2, out.getvalue())
        self.assertIn("duplicate key 'update' on line 2 (first on line 1)", out.getvalue())
        self.assertEqual(host.calls, [])

    def test_the_lint_on_a_memory_directory_named_directly_fails_in_every_mode(self):
        # Named directly, the lint follows no pointer, so kit_home.resolve never reads the conf; the
        # mode still comes from it, loaded as a tier is loaded.
        tree(self.root, {"home/memory-kit.conf": "mode: gauge\nmode: gate\n", "home/memory/scratchpad.yaml": "current: []\nstaging: []\n"})
        lint = [sys.executable, str(HERE.parent / "lint" / "memory_lint.py"), str(self.root / "home" / "memory")]
        for mode in ([], ["--report"]):
            r = subprocess.run([*lint, *mode], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(r.returncode, 2, r.stdout)
            self.assertIn(f"FAIL memory-kit.conf: {self.root / 'home' / 'memory-kit.conf'}: duplicate key 'mode' on line 2 (first on line 1)", r.stdout)


class KitHomeUpward(unittest.TestCase):
    """kit #42: a start folder without a conf takes the nearest one above it, when asked."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_subfolder_finds_its_home_only_when_asked(self):
        tree(self.root, {"home/memory-kit.conf": "memory_dir: memory\n", "home/a/b/x.txt": ""})
        r = kit_home.resolve(self.root / "home/a/b", upward=True)
        self.assertEqual((r.home, r.pointer, r.problem, r.found_in), (self.root / "home", None, None, self.root / "home"))
        r = kit_home.resolve(self.root / "home/a/b")
        self.assertEqual((r.home, r.found_in), (self.root / "home/a/b", None))

    def test_a_pointer_found_above_counts_from_its_own_folder(self):
        tree(self.root, {"3D/memory-kit.conf": "kit_home: workshop\n", "3D/workshop/memory-kit.conf": "", "3D/slicer/.worktrees/m4/x": ""})
        r = kit_home.resolve(self.root / "3D/slicer/.worktrees/m4", upward=True)
        self.assertEqual((r.home, r.pointer, r.found_in), (self.root / "3D/workshop", self.root / "3D/memory-kit.conf", self.root / "3D"))

    def test_the_start_folders_own_conf_beats_any_above(self):
        tree(self.root, {"home/memory-kit.conf": "", "home/a/memory-kit.conf": ""})
        r = kit_home.resolve(self.root / "home/a", upward=True)
        self.assertEqual((r.home, r.found_in), (self.root / "home/a", None))

    def test_a_broken_pointer_found_above_is_a_problem(self):
        tree(self.root, {"home/memory-kit.conf": "kit_home: ../gone\n", "home/a/x": ""})
        self.assertIn("no memory-kit.conf there", kit_home.resolve(self.root / "home/a", upward=True).problem)

    def test_the_note_is_the_plugins_text(self):
        self.assertEqual(kit_home.found_above_note("/u/3D/slicer/", "/u/3D"), "/u/3D/slicer has no memory-kit.conf; using the nearest one above it, in /u/3D")

    def test_the_lint_walks_only_when_no_folder_is_named(self):
        kit = HERE.parent
        tree(self.root, {"home/memory-kit.conf": "memory_dir: memory\n", "home/memory/rules.yaml": "rules: []\n", "home/sub/x": ""})
        lint = [sys.executable, str(kit / "lint" / "memory_lint.py")]
        unnamed = subprocess.run(lint, cwd=self.root / "home/sub", capture_output=True, text=True, encoding="utf-8")
        self.assertIn("using the nearest one above it", unnamed.stdout)
        named = subprocess.run([*lint, str(self.root / "home/sub")], capture_output=True, text=True, encoding="utf-8")
        self.assertNotIn("using the nearest one above it", named.stdout)


class NoConf(unittest.TestCase):
    """Kit #31: a start folder with no memory-kit.conf is said plainly, worded as the plugins'
    hooks/kit-home.ts words it."""

    def test_the_notice_is_the_plugins_text(self):
        self.assertEqual(kit_home.no_conf_notice("/u/start/"), "/u/start has no memory-kit.conf, so it is not a kit home; if the home is elsewhere, put kit_home: <path> in a memory-kit.conf here")

    def test_kit_update_on_a_folder_with_no_conf_says_so_exit_2(self):
        with tempfile.TemporaryDirectory() as d:
            out = io.StringIO()
            with redirect_stdout(out):
                code = ku.main(["kit-update.py", d])
            self.assertEqual(code, 2)
            self.assertIn(f"kit-update: {d} has no memory-kit.conf, so it is not a kit home; if the home is elsewhere, put kit_home: <path> in a memory-kit.conf here. kit-update checks nothing until it has one.", out.getvalue())


class ToolsFollowThePointer(unittest.TestCase):
    def test_kit_update_runs_on_the_home_the_pointer_names(self):
        host = FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"])
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            tree(root, {
                "start/memory-kit.conf": "kit_home: ../desk\n",
                "desk/memory-kit.conf": "update: latest\n",
                "desk/memory-kit/VERSION": "0.1.0-alpha.13\n",
            })
            real, ku.subprocess.run = ku.subprocess.run, host
            out = io.StringIO()
            try:
                with redirect_stdout(out):
                    code = ku.main(["kit-update.py", str(root / "start")])
            finally:
                ku.subprocess.run = real
            self.assertEqual(code, 0, out.getvalue())
            self.assertIn(f"following kit_home in {root / 'start' / 'memory-kit.conf'} to {root / 'desk'}", out.getvalue())
            homes = {argv[2] for argv, kw in host.calls if argv[:2] == ["git", "-C"]}
            self.assertEqual(homes, {str(root / "desk")})

    def test_kit_update_refuses_a_broken_pointer(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            tree(root, {"start/memory-kit.conf": "kit_home: ../nowhere\n"})
            out = io.StringIO()
            with redirect_stdout(out):
                code = ku.main(["kit-update.py", str(root / "start")])
            self.assertEqual(code, 2)
            self.assertIn("no memory-kit.conf", out.getvalue())

    def test_obligations_due_reads_the_home_the_pointer_names(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            tree(root, {
                "start/memory-kit.conf": "kit_home: ../desk\n",
                "desk/memory-kit.conf": "memory_dir: notes\n",
                "desk/notes/obligations.yaml": "obligations:\n  - obligation: from the desk\n    actor: Pepys\n    expires: 2000-01-01\n",
            })
            self.assertEqual(due.memory_dir(root / "start"), root / "desk" / "notes")
            out = io.StringIO()
            with redirect_stdout(out):
                code = due.main(["obligations-due.py", str(root / "start")])
            self.assertEqual(code, 0)
            self.assertIn("from the desk", out.getvalue())


class NestedHome(unittest.TestCase):
    """Kit #49 (apex-research; framework-research in #24): a home that is a folder inside a larger
    repo, teams/<name>/. git subtree runs only from the top of the work tree, so the tool ran it in
    the home and git refused; the paths git gives count from the top, not from the home."""

    TAGS = ["v0.1.0-alpha.13", "v0.1.0-alpha.14"]

    def git_calls(self, host, cmd):
        return [argv for argv, kw in host.calls if argv[:2] == ["git", "-C"] and argv[3] == cmd]

    def test_the_pull_runs_from_the_top_with_the_prefix_counted_from_there(self):
        host = FakeHost(tags=self.TAGS, nested="teams/apex")
        seen = {}
        code, out = run_tool(host, home_rel="ws/teams/apex", home_out=seen)
        self.assertEqual(code, 0, out)
        self.assertIn("updated 0.1.0-alpha.13 -> 0.1.0-alpha.14", out)
        [pull] = self.git_calls(host, "subtree")
        self.assertEqual(pull[2], str(seen["home"].parent.parent))
        self.assertIn("--prefix=teams/apex/memory-kit", pull)

    def test_a_home_at_the_top_keeps_the_plain_prefix(self):
        host = FakeHost(tags=self.TAGS)
        seen = {}
        code, out = run_tool(host, home_out=seen)
        self.assertEqual(code, 0, out)
        [pull] = self.git_calls(host, "subtree")
        self.assertEqual(pull[2], str(seen["home"]))
        self.assertIn("--prefix=memory-kit", pull)

    def test_an_untracked_file_under_the_homes_kit_refuses_and_one_elsewhere_does_not(self):
        status = "?? teams/apex/memory-kit/lint/stray.py\n?? teams/apex/todo.txt\n?? teams/other/memory-kit/x.py"
        code, out = run_tool(FakeHost(tags=self.TAGS, status=status, nested="teams/apex"), home_rel="ws/teams/apex")
        self.assertEqual(code, 1)
        self.assertIn("teams/apex/memory-kit/lint/stray.py", out)
        self.assertNotIn("todo.txt", out)
        self.assertNotIn("teams/other", out)

    def test_a_tracked_change_elsewhere_in_the_repo_refuses_and_says_whose(self):
        # git subtree refuses a tracked change anywhere in the work tree, so the tool does first.
        code, out = run_tool(FakeHost(tags=self.TAGS, status=" M teams/other/memory/rules.yaml", nested="teams/apex"),
                             home_rel="ws/teams/apex")
        self.assertEqual(code, 1)
        self.assertIn("the repo the home is in (", out)
        self.assertIn("has uncommitted changes; commit or stash them first: teams/other/memory/rules.yaml", out)

    def test_the_changed_plugins_are_found_below_the_top(self):
        for nested in ("teams/apex", "teams/kõrts x"):  # git quotes such a path unless -z
            with self.subTest(nested=nested):
                diff = (f"{nested}/memory-kit/adapters/claude-code/watch/hooks/watch.ts\n"
                        f"{nested}/memory-kit/adapters/claude-code/obligations-pane/README.md\n")
                code, out = run_tool(FakeHost(tags=self.TAGS, diff=diff, nested=nested), home_rel=f"ws/{nested}")
                self.assertEqual(code, 0, out)
                self.assertIn("plugins changed: obligations-pane, watch", out)
                self.assertIn("kit-update:   claude plugin update watch@memory-kit", out)

    def test_a_home_outside_any_git_work_tree_is_said_exit_2(self):
        host = FakeHost(tags=self.TAGS, repo=False)
        code, out = run_tool(host)
        self.assertEqual(code, 2, out)
        self.assertIn("is not in a git work tree", out)
        self.assertEqual(self.git_calls(host, "subtree"), [])


class UndoWithoutResetHard(unittest.TestCase):
    """Kit #24 (semafor): on a failed pull or lint the tool ran git reset --hard, which semafor's
    settings deny; a tool must not route around a deny. A failed subtree pull makes no commit, but
    it can leave a merge in progress (a conflict, or a commit hook refusing the subject: semafor's
    case), which git merge --abort undoes; the pull's commit, after a lint failure, goes with git
    reset --keep, which refuses rather than overwrite a local change. Then the end is checked."""

    TAGS = ["v0.1.0-alpha.13", "v0.1.0-alpha.14"]

    def no_hard(self, host, out):
        self.assertEqual([c for c in host.git_calls("reset") if "--hard" in c], [])
        self.assertNotIn("--hard", out)

    def test_a_merge_the_pull_left_in_progress_is_aborted(self):
        for pull, said in (("conflict", "Merge conflict in VERSION"), ("hook", "need a story ref")):
            with self.subTest(pull=pull):
                host = FakeHost(tags=self.TAGS, pull=pull)
                code, out = run_tool(host)
                self.assertEqual(code, 1, out)
                self.assertIn(said, out)
                self.assertIn("; the pull is undone (back to start123)", out)
                self.assertEqual(host.git_calls("merge"), [["merge", "--abort"]])
                self.assertEqual(host.git_calls("reset"), [])
                self.no_hard(host, out)

    def test_a_pull_that_failed_before_merging_is_left_alone(self):
        host = FakeHost(tags=self.TAGS, pull="refused")
        code, out = run_tool(host)
        self.assertEqual(code, 1, out)
        self.assertIn("Cannot add.; nothing changed (still at start123)", out)
        self.assertEqual(host.git_calls("merge") + host.git_calls("reset"), [])

    def test_a_lint_failure_takes_the_pull_commit_back_with_reset_keep(self):
        host = FakeHost(tags=self.TAGS, lint="fail")
        code, out = run_tool(host)
        self.assertEqual(code, 1, out)
        self.assertIn("    FAIL rules.yaml: a check the new version added", out)
        self.assertIn("the lint gate failed on the new version; the pull is undone (back to start123)", out)
        self.assertEqual(host.git_calls("reset"), [["reset", "--keep", "start123"]])
        self.assertEqual(host.head, "start123")
        self.no_hard(host, out)

    def test_a_reset_keep_that_refuses_is_said_exit_3_and_nothing_forced(self):
        host = FakeHost(tags=self.TAGS, lint="fail", keep_rc=128)
        code, out = run_tool(host)
        self.assertEqual(code, ku.EXIT_ROLLBACK_FAILED, out)
        self.assertIn("the lint gate failed on the new version, AND the undo failed", out)
        self.assertIn("git reset --keep start123 said: error: Entry 'memory-kit/VERSION' not uptodate.", out)
        self.assertEqual(host.git_calls("reset"), [["reset", "--keep", "start123"]])
        self.no_hard(host, out)

    def test_a_change_left_behind_is_never_called_undone(self):
        host = FakeHost(tags=self.TAGS, pull="hang-dirty")
        code, out = run_tool(host)
        self.assertEqual(code, ku.EXIT_ROLLBACK_FAILED, out)
        self.assertIn("still changed: memory-kit/VERSION", out)
        self.assertEqual(host.git_calls("reset"), [])
        self.no_hard(host, out)

    def test_a_nested_home_is_undone_at_the_top(self):
        host = FakeHost(tags=self.TAGS, lint="fail", nested="teams/apex")
        seen = {}
        code, out = run_tool(host, home_rel="ws/teams/apex", home_out=seen)
        self.assertEqual(code, 1, out)
        [reset] = [argv for argv, kw in host.calls if argv[:2] == ["git", "-C"] and argv[3] == "reset"]
        self.assertEqual(reset, ["git", "-C", str(seen["home"].parent.parent), "reset", "--keep", "start123"])


class UntrackedFiles(unittest.TestCase):
    """Kit #25: an untracked scratch folder outside memory-kit/ refused the update. The undo
    (merge --abort, reset --keep; kit #24) leaves untracked files alone, and the pull writes only
    under memory-kit/."""

    def test_untracked_files_outside_the_kit_do_not_refuse(self):
        code, out = run_tool(FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"], status="?? scratchpad/notes.md\n?? todo.txt"))
        self.assertEqual(code, 0, out)
        self.assertIn("updated 0.1.0-alpha.13 -> 0.1.0-alpha.14", out)

    def test_a_tracked_change_anywhere_refuses_and_is_named(self):
        code, out = run_tool(FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"], status=" M memory/rules.yaml\n?? todo.txt"))
        self.assertEqual(code, 1)
        self.assertIn("uncommitted changes", out)
        self.assertIn("memory/rules.yaml", out)
        self.assertNotIn("todo.txt", out)

    def test_an_untracked_file_under_the_kit_refuses_and_is_named(self):
        code, out = run_tool(FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"], status="?? memory-kit/lint/stray.py\n?? todo.txt"))
        self.assertEqual(code, 1)
        self.assertIn("untracked under memory-kit/", out)
        self.assertIn("memory-kit/lint/stray.py", out)
        self.assertNotIn("todo.txt", out)

    def test_many_files_are_named_five_then_counted(self):
        status = "\n".join(f" M memory/facts/f{i}.yaml" for i in range(8))
        code, out = run_tool(FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"], status=status))
        self.assertEqual(code, 1)
        self.assertIn("memory/facts/f4.yaml +3 more", out)


class PluginSteps(unittest.TestCase):
    """Kit #23: a subtree pull never updates an installed plugin (the harness keeps its own copy),
    so /reload-plugins alone left po-team's pane at 0.1.0. The tool names the whole sequence."""

    TAGS = ["v0.1.0-alpha.13", "v0.1.0-alpha.14"]

    def test_changed_plugins_get_the_marketplace_update_each_update_then_reload(self):
        diff = ("memory-kit/adapters/claude-code/watch/hooks/watch.ts\n"
                "memory-kit/adapters/claude-code/obligations-pane/README.md\n"
                "memory-kit/adapters/claude-code/watch/README.md\n")
        code, out = run_tool(FakeHost(tags=self.TAGS, diff=diff))
        self.assertEqual(code, 0, out)
        lines = out.splitlines()
        i = lines.index("kit-update:   claude plugin marketplace update memory-kit")
        self.assertEqual(lines[i + 1:i + 4], [
            "kit-update:   claude plugin update obligations-pane@memory-kit",
            "kit-update:   claude plugin update watch@memory-kit",
            "kit-update:   then /reload-plugins in every session of this home",
        ])
        self.assertIn("plugins changed: obligations-pane, watch", out)

    def test_the_marketplace_alone_changed_needs_no_plugin_update(self):
        code, out = run_tool(FakeHost(tags=self.TAGS, diff="memory-kit/adapters/claude-code/.claude-plugin/marketplace.json\n"))
        self.assertEqual(code, 0, out)
        self.assertIn("claude plugin marketplace update memory-kit", out)
        self.assertNotIn("claude plugin update ", out)

    def test_no_adapter_change_says_nothing_about_plugins(self):
        code, out = run_tool(FakeHost(tags=self.TAGS))
        self.assertEqual(code, 0, out)
        self.assertNotIn("plugin", out)


class RunsPluginSteps(unittest.TestCase):
    """Kit #37 (po-team): the marketplace is a Directory source inside the subtree, and Claude Code
    never re-copies from it unasked, so after a pull the plugins stayed old. With claude on PATH
    the tool runs the marketplace update and a plugin update per changed plugin the home has
    installed; without it, it prints them as #23 did."""

    TAGS = ["v0.1.0-alpha.13", "v0.1.0-alpha.14"]
    DIFF = ("memory-kit/adapters/claude-code/watch/hooks/watch.ts\n"
            "memory-kit/adapters/claude-code/obligations-pane/README.md\n"
            "memory-kit/adapters/claude-code/kit-update/hooks/register.ts\n")

    def test_claude_on_path_runs_the_marketplace_update_then_each_installed_changed_plugin(self):
        host = FakeHost(tags=self.TAGS, diff=self.DIFF, installed=["watch", "obligations-pane"])
        seen = {}
        code, out = run_tool(host, claude=True, home_out=seen)
        self.assertEqual(code, 0, out)
        calls = host.claude_calls()
        self.assertEqual([c[1:] for c in calls], [
            ["plugin", "list", "--json"],
            ["plugin", "marketplace", "update", "memory-kit"],
            ["plugin", "update", "obligations-pane@memory-kit"],
            ["plugin", "update", "watch@memory-kit"],
        ])
        # The claude found on PATH, never another; run in the home, so a project-scope install counts.
        self.assertTrue(all(c[0].endswith("/bin/claude") and pathlib.Path(c[0]).parent.name == "bin" for c in calls))
        cwds = {kw.get("cwd") for argv, kw in host.calls if pathlib.Path(argv[0]).name == "claude"}
        self.assertEqual(cwds, {str(seen["home"])})
        self.assertTrue(all(kw.get("timeout") == ku.CLAUDE_TIMEOUT for argv, kw in host.calls if pathlib.Path(argv[0]).name == "claude"))
        self.assertIn("kit-update: ran: claude plugin marketplace update memory-kit", out)
        self.assertIn("kit-update: ran: claude plugin update obligations-pane@memory-kit", out)
        self.assertIn("kit-update: ran: claude plugin update watch@memory-kit", out)
        self.assertIn("kit-update: not installed here, so not updated: kit-update", out)
        self.assertTrue(out.rstrip().endswith("kit-update: now /reload-plugins in every session of this home"), out)

    def test_claude_not_on_path_prints_the_steps_as_before(self):
        host = FakeHost(tags=self.TAGS, diff=self.DIFF, installed=["watch"])
        code, out = run_tool(host, claude=False)
        self.assertEqual(code, 0, out)
        self.assertEqual(host.claude_calls(), [])
        self.assertIn("kit-update: a pull never updates an installed plugin, and claude is not on PATH; run, in order (each plugin this home has installed):", out)
        self.assertIn("kit-update:   claude plugin marketplace update memory-kit", out)
        self.assertIn("kit-update:   claude plugin update watch@memory-kit", out)
        self.assertIn("kit-update:   then /reload-plugins in every session of this home", out)

    def test_no_memory_kit_plugin_installed_runs_nothing_more(self):
        host = FakeHost(tags=self.TAGS, diff=self.DIFF, installed=[])
        code, out = run_tool(host, claude=True)
        self.assertEqual(code, 0, out)
        self.assertEqual([c[1:] for c in host.claude_calls()], [["plugin", "list", "--json"]])
        self.assertIn("no memory-kit plugin is installed for this home; nothing to update", out)
        self.assertNotIn("/reload-plugins", out)

    def test_the_marketplace_alone_changed_runs_only_the_marketplace_update(self):
        host = FakeHost(tags=self.TAGS, diff="memory-kit/adapters/claude-code/.claude-plugin/marketplace.json\n", installed=["watch"])
        code, out = run_tool(host, claude=True)
        self.assertEqual(code, 0, out)
        self.assertEqual([c[1:] for c in host.claude_calls()],
                         [["plugin", "list", "--json"], ["plugin", "marketplace", "update", "memory-kit"]])
        self.assertIn("now /reload-plugins", out)

    def test_a_list_that_fails_falls_back_to_printing_the_steps(self):
        host = FakeHost(tags=self.TAGS, diff=self.DIFF, installed=["watch"], claude_rc={"list": 1})
        code, out = run_tool(host, claude=True)
        self.assertEqual(code, 0, out)
        self.assertEqual(len(host.claude_calls()), 1)
        self.assertIn("cannot list the installed plugins (claude plugin list --json: exit 1: list failed); run, in order", out)
        self.assertIn("kit-update:   claude plugin update watch@memory-kit", out)

    def test_a_failed_marketplace_update_runs_no_plugin_update_and_prints_the_rest(self):
        for rc, why in ((1, "exit 1: marketplace failed"), ("hang", f"timed out after {ku.CLAUDE_TIMEOUT} s")):
            with self.subTest(rc=rc):
                host = FakeHost(tags=self.TAGS, diff=self.DIFF, installed=["watch"], claude_rc={"marketplace": rc})
                code, out = run_tool(host, claude=True)
                self.assertEqual(code, 0, out)  # the kit update stands; the plugin step is said
                self.assertEqual(len(host.claude_calls()), 2)
                self.assertIn(f"FAILED: claude plugin marketplace update memory-kit ({why})", out)
                self.assertIn("kit-update:   claude plugin update watch@memory-kit", out)
                self.assertIn("the kit update itself is committed", out)

    def test_a_failed_plugin_update_is_named_and_the_others_still_run(self):
        host = FakeHost(tags=self.TAGS, diff=self.DIFF, installed=["watch", "obligations-pane"],
                        claude_rc={"update obligations-pane@memory-kit": 1})
        code, out = run_tool(host, claude=True)
        self.assertEqual(code, 0, out)
        self.assertEqual(len(host.claude_calls()), 4)
        self.assertIn("FAILED: claude plugin update obligations-pane@memory-kit (exit 1: update obligations-pane@memory-kit failed)", out)
        self.assertIn("ran: claude plugin update watch@memory-kit", out)

    def test_no_adapter_change_runs_no_claude(self):
        host = FakeHost(tags=self.TAGS, installed=["watch"])
        code, out = run_tool(host, claude=True)
        self.assertEqual(code, 0, out)
        self.assertEqual(host.claude_calls(), [])

    def test_a_dry_run_runs_no_claude(self):
        host = FakeHost(tags=self.TAGS, diff=self.DIFF, installed=["watch"])
        with tempfile.TemporaryDirectory() as d:
            home = pathlib.Path(d) / "home"
            tree(home, {"memory-kit/VERSION": "0.1.0-alpha.13\n", "memory-kit.conf": "update: latest\n"})
            real, ku.subprocess.run = ku.subprocess.run, host
            try:
                with redirect_stdout(io.StringIO()), mock.patch.dict(os.environ, {"PATH": str(bin_dir(d, True))}):
                    self.assertEqual(ku.main(["kit-update.py", str(home), "--dry-run"]), 0)
            finally:
                ku.subprocess.run = real
        self.assertEqual(host.claude_calls(), [])

    @unittest.skipIf(os.name == "nt", "the fake claude is a sh script")
    def test_end_to_end_the_fake_claude_on_path_is_what_runs_in_the_home(self):
        # The claude calls go to a real process here: the fake on PATH, which records each call.
        host = FakeHost(tags=self.TAGS, diff="memory-kit/adapters/claude-code/watch/hooks/watch.ts\n", claude_real=True)
        seen = {}
        code, out = run_tool(host, claude=True, home_out=seen)
        self.assertEqual(code, 0, out)
        home = os.path.realpath(seen["home"])
        self.assertEqual(seen["calls"].splitlines(), [
            f"{home}|plugin list --json",
            f"{home}|plugin marketplace update memory-kit",
            f"{home}|plugin update watch@memory-kit",
        ])
        self.assertIn("ran: claude plugin update watch@memory-kit", out)


class SubjectPrefix(unittest.TestCase):
    """Kit #24 (semafor; the desk): a home whose commit hook wants a story reference first (#123,
    a Jira key) refused the update's fixed subject. update_subject_prefix in the home's
    memory-kit.conf goes before it, with one space."""

    TAGS = ["v0.1.0-alpha.13", "v0.1.0-alpha.14"]
    SUBJECT = "chore: memory-kit 0.1.0-alpha.13 -> 0.1.0-alpha.14 (kit-update, latest)"

    def subject(self, conf):
        host = FakeHost(tags=self.TAGS)
        code, out = run_tool(host, conf=conf)
        self.assertEqual(code, 0, out)
        [pull] = host.git_calls("subtree")
        return pull[pull.index("-m") + 1]

    def test_no_key_keeps_the_subject(self):
        self.assertEqual(self.subject(""), self.SUBJECT)
        self.assertEqual(self.subject("update_subject_prefix:\n"), self.SUBJECT)

    def test_the_prefix_goes_first_with_one_space(self):
        for conf, prefix in (('update_subject_prefix: "#123"\n', "#123"),
                             ("update_subject_prefix: 'ABC-12:'  # the story for kit upkeep\n", "ABC-12:"),
                             ('update_subject_prefix: "[KIT-7]"\n', "[KIT-7]"),
                             ('update_subject_prefix: "#123 "\n', "#123")):
            with self.subTest(conf=conf):
                self.assertEqual(self.subject(conf), f"{prefix} {self.SUBJECT}")


class Flags(unittest.TestCase):
    """Kit #32: --help ran a real update, because every unknown -- flag was dropped silently."""

    def run_main(self, *argv):
        host = FakeHost(tags=["v0.1.0-alpha.13", "v0.1.0-alpha.14"])
        real, ku.subprocess.run = ku.subprocess.run, host
        out = io.StringIO()
        try:
            with redirect_stdout(out):
                code = ku.main(["kit-update.py", *argv])
        finally:
            ku.subprocess.run = real
        return code, out.getvalue(), host.calls

    def test_help_prints_the_usage_and_runs_nothing(self):
        for flag in ("--help", "-h"):
            code, out, calls = self.run_main(flag)
            self.assertEqual(code, 0, flag)
            self.assertIn("kit-update.py [home] [--dry-run]", out)
            self.assertEqual(calls, [], flag)

    def test_an_unknown_flag_is_bad_usage_exit_2_and_runs_nothing(self):
        for flag in ("--dry-rn", "-n", "--force"):
            code, out, calls = self.run_main(".", flag)
            self.assertEqual(code, 2, flag)
            self.assertIn(f"unknown option {flag}", out)
            self.assertEqual(calls, [], flag)

    def test_two_homes_is_bad_usage(self):
        code, out, calls = self.run_main("a", "b")
        self.assertEqual(code, 2)
        self.assertIn("one home at most", out)
        self.assertEqual(calls, [])

    def test_help_after_a_real_home_runs_nothing(self):
        # Kit #24, comment (hr2, alpha.15): `kit-update.py <home> --help` ran the update. The home
        # here would update (latest, a newer tag), so any call at all would be the bug.
        with tempfile.TemporaryDirectory() as d:
            tree(pathlib.Path(d), {"memory-kit/VERSION": "0.1.0-alpha.13\n", "memory-kit.conf": "update: latest\n"})
            for argv in ((d, "--help"), (d, "-h"), (d, "--dry-run", "--help"), (d, "--force", "-h")):
                with self.subTest(argv=argv[1:]):
                    code, out, calls = self.run_main(*argv)
                    self.assertEqual(code, 0)
                    self.assertTrue(out.startswith("Move a home's vendored memory-kit"), out)
                    self.assertEqual(calls, [])

    def test_an_unknown_argument_after_a_real_home_is_bad_usage_and_runs_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            tree(pathlib.Path(d), {"memory-kit/VERSION": "0.1.0-alpha.13\n", "memory-kit.conf": "update: latest\n"})
            for extra in ("--force", "--dry-run=yes", "-", "--", "help"):
                with self.subTest(extra=extra):
                    code, out, calls = self.run_main(d, extra)
                    self.assertEqual(code, 2, out)
                    self.assertEqual(calls, [])


class TheShippedUpgradeMd(unittest.TestCase):
    def test_the_next_hop_is_named_and_reads_as_no_data_step(self):
        # The real file, not a copy: a heading the tool cannot parse makes every home's update a
        # manual one.
        text = (HERE.parent / "UPGRADE.md").read_text(encoding="utf-8")
        self.assertIsNone(ku.data_steps_ok(text, ["0.1.0-alpha.15", "0.1.0-alpha.16"]))
        self.assertIsNone(ku.data_steps_ok(text, ["0.1.0-alpha.12", "0.1.0-alpha.13", "0.1.0-alpha.14", "0.1.0-alpha.15", "0.1.0-alpha.16"]))


class ObligationsDueShowsWhoIsOwed(unittest.TestCase):
    def test_a_row_with_owed_to_names_both_parties_and_one_without_is_unchanged(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            tree(root, {
                "memory/obligations.yaml": (
                    "obligations:\n"
                    "  - obligation: answer the email\n    actor: Pepys\n    owed_to: the board\n    expires: 2000-01-01\n"
                    "  - obligation: from before owed_to\n    actor: Pepys\n    expires: 2000-01-02\n"),
            })
            out = io.StringIO()
            with redirect_stdout(out):
                code = due.main(["obligations-due.py", str(root)])
            self.assertEqual(code, 0)
            self.assertIn("- 2000-01-01  Pepys -> the board: answer the email", out.getvalue())
            self.assertIn("- 2000-01-02  Pepys: from before owed_to", out.getvalue())



class ObligationsDueRefusesADuplicateKey(unittest.TestCase):
    """Kit #55: obligations-due.py loads as the lint loads, so a key given twice is an error naming
    the file, the key and both lines, worded as the lint words it; never the last copy, silently."""

    def run_due(self, root):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            try:
                code = due.main(["obligations-due.py", str(root)])
            except SystemExit as e:
                code = e.code
        return code, out.getvalue(), err.getvalue()

    def test_a_row_with_check_twice_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            tree(root, {
                "memory/obligations.yaml": (
                    "obligations:\n"
                    "  - obligation: answer the email\n    actor: Pepys\n    expires: 2000-01-01\n"
                    "    check: read the thread\n    check: ask the board\n"),
            })
            code, out, err = self.run_due(root)
            self.assertEqual(code, 2)
            self.assertEqual(out, "")
            path = root / "memory" / "obligations.yaml"
            self.assertEqual(err, f"memory-kit: {path}: duplicate key 'check' on line 6 (first on line 5); YAML keeps only the last, silently\n")

    def test_a_conf_with_a_key_twice_in_an_entry_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            tree(root, {
                "memory-kit.conf": "memory_dir: memory\nwatch_files:\n  - label: a\n    label: b\n",
                "memory/obligations.yaml": "obligations: []\n",
            })
            code, out, err = self.run_due(root)
            self.assertEqual(code, 2)
            self.assertIn(f"{root / 'memory-kit.conf'}: duplicate key 'label' on line 4 (first on line 3)", err)

    def test_the_same_key_in_two_rows_is_not_a_duplicate(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            tree(root, {
                "memory/obligations.yaml": (
                    "obligations:\n"
                    "  - obligation: one\n    actor: Pepys\n    expires: 2000-01-01\n"
                    "  - obligation: two\n    actor: Pepys\n    expires: 2000-01-02\n"),
            })
            code, out, err = self.run_due(root)
            self.assertEqual((code, err), (0, ""))
            self.assertIn("## expired (2)", out)


if __name__ == "__main__":
    unittest.main(verbosity=1)
