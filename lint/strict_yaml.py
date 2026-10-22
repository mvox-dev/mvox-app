"""strict_yaml: YAML loading that refuses a key given twice (kit #54, kit #55).

PyYAML's safe_load keeps the last copy of a repeated key, silently, while the memory pane refuses
the file: one file read as two. The lint and the tools (lesson-index.py, obligations-due.py) load
through here, so a tool run on its own reads a file as the gate reads it.

Needs PyYAML; each importer checks for it first, with its own message.
"""
import yaml


class DuplicateKey(yaml.YAMLError):
    """One mapping holds a key twice (kit #54). PyYAML keeps the last silently and the memory
    pane refuses the file, so one file read as two. Lines are 1-based, in the text loaded."""

    def __init__(self, key, line, first):
        super().__init__(f"duplicate key {key!r} on line {line} (first on line {first})")
        self.key, self.line, self.first = key, line, first

    def shifted(self, by):
        """The same finding with its lines moved, for text cut out of a longer file."""
        return DuplicateKey(self.key, self.line + by, self.first + by)

    def message(self):
        return f"{self}; YAML keeps only the last, silently"


class StrictLoader(yaml.SafeLoader):
    """safe_load that refuses a duplicate key at every depth instead of keeping the last: a lost
    row field is silent data loss as much as a lost top-level block (kit #54)."""

    def construct_mapping(self, node, deep=False):
        if isinstance(node, yaml.MappingNode):
            seen = {}
            for key_node, _ in node.value:
                # A merge key (<<) brings in keys the mapping's own may override, as YAML intends.
                if key_node.tag == "tag:yaml.org,2002:merge":
                    continue
                key = self.construct_object(key_node, deep=deep)
                try:
                    hash(key)
                except TypeError:
                    continue  # an unhashable key: the base class refuses it with its own error
                line = key_node.start_mark.line + 1
                if key in seen:
                    raise DuplicateKey(key, line, seen[key])
                seen[key] = line
        return super().construct_mapping(node, deep=deep)


def strict_load(text):
    """yaml.safe_load, except that a key given twice raises DuplicateKey."""
    return yaml.load(text, Loader=StrictLoader)
