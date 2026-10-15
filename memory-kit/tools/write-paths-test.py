#!/usr/bin/env python3
"""Tests that run the tools' file writes: lesson-index.py and extract-caps.py. Stdlib unittest and
PyYAML (lesson-index.py needs it), no network.

    python3 tools/write-paths-test.py

Kit #34: the newline= of Path.write_text exists from Python 3.10 only, so on macOS's system 3.9 both
tools crashed at the write, and the fixture run passed 35/0 there because it runs the lint alone.
Each write here runs for real, into a temporary folder, on whatever python3 runs the test; and a
scan keeps write_text(newline=) out of the kit's Python, which a newer python3 would not catch.
"""
import importlib.util
import io
import pathlib
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

sys.dont_write_bytecode = True
HERE = pathlib.Path(__file__).resolve().parent
KIT = HERE.parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


li = load("lesson_index", "lesson-index.py")
caps = load("extract_caps", "extract-caps.py")

LESSON = '---\nsummary: "Stays LF, says ä and š."\nlearned: "2026-10-15"\nref: mac-sysops:2026-10-15\nenforcement: recognition\n---\n# T\nbody\n'


def quiet(fn, *args):
    out = io.StringIO()
    with redirect_stdout(out):
        code = fn(*args)
    return code, out.getvalue()


class LessonIndexWrites(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.mem = pathlib.Path(self.tmp.name) / "memory"
        (self.mem / "lessons").mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_index_is_written_utf8_with_lf_and_then_checks_current(self):
        (self.mem / "lessons" / "a.md").write_bytes(LESSON.encode("utf-8"))
        code, out = quiet(li.main, [str(self.mem)])
        self.assertEqual(code, 0, out)
        self.assertIn("1 lessons", out)
        raw = (self.mem / "lessons" / "index.yaml").read_bytes()
        self.assertNotIn(b"\r\n", raw)
        self.assertIn("ä and š".encode("utf-8"), raw)
        self.assertEqual(quiet(li.main, [str(self.mem), "--check"])[0], 0)

    def test_from_index_writes_front_matter_utf8_with_lf(self):
        (self.mem / "lessons" / "b.md").write_bytes("# B\nbody\n".encode("utf-8"))
        (self.mem / "lessons" / "index.yaml").write_bytes(
            'lessons:\n- slug: b\n  summary: "Front matter, ä."\n  learned: "2026-10-15"\n  ref: x:2026-10-15\n  enforcement: recognition\n'.encode("utf-8"))
        code, out = quiet(li.main, [str(self.mem), "--from-index"])
        self.assertEqual(code, 0, out)
        self.assertIn("front matter written into 1 lesson(s)", out)
        raw = (self.mem / "lessons" / "b.md").read_bytes()
        self.assertTrue(raw.startswith(b"---\n"), raw[:40])
        self.assertNotIn(b"\r\n", raw)
        self.assertTrue(raw.endswith(b"# B\nbody\n"))
        self.assertEqual(li.front_matter(self.mem / "lessons" / "b.md")["summary"], "Front matter, ä.")


class ExtractCapsWrites(unittest.TestCase):
    def test_caps_yaml_is_written_with_lf_and_matches_the_extract(self):
        with tempfile.TemporaryDirectory() as d:
            out_file = pathlib.Path(d) / "caps.yaml"
            real, caps.OUT = caps.OUT, out_file  # never the kit's own caps.yaml
            try:
                code, out = quiet(caps.main)
            finally:
                caps.OUT = real
            self.assertEqual(code, 0, out)
            raw = out_file.read_bytes()
            self.assertNotIn(b"\r\n", raw)
            self.assertEqual(raw.decode("utf-8"), caps.extract())


class NoWriteTextNewline(unittest.TestCase):
    def test_no_kit_python_passes_newline_to_write_text(self):
        # A newer python3 accepts it, so only a scan catches it where the suite runs on 3.10+.
        files = [*KIT.glob("lint/*.py"), *KIT.glob("tools/*.py"), *KIT.glob("adapters/claude-code/**/*.py")]
        bad = [f"{p.relative_to(KIT)}:{n}" for p in files if p.name != "write-paths-test.py"
               for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
               if re.search(r"\.write_text\([^)]*newline=", line)]
        self.assertEqual(bad, [], "Path.write_text with newline= is Python 3.10+; write through the built-in open instead")


if __name__ == "__main__":
    unittest.main(verbosity=1)
