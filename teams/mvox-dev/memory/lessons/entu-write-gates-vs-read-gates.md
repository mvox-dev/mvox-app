---
summary: "Reasoning about Entu rights, keeping who-may-write separate from who-sees-which-field."
learned: '2026-09-07'
ref: urls/mem-finn-9d2803d
enforcement: recognition
---
# Entu write gates and read gates are separate

**When:** a design or bug touches both mutation rights and field visibility.

## Why

Write rights are per verb: adding a property needs `_editor`, but DELETE of a rights-type property (including `_parent`) needs `_owner`; an editor once got a stranded duplicate parent this way (#264). Read visibility is per property definition, so one entity can show `name` at domain and keep phone and email private.

## What to do

- To replace a value as an editor, POST it with the old value `_id` (docs: "Overwriting a Property Value").
- For field visibility, set sharing per property definition.
- Cite entu/www (urls/entu-www-repo), not memory.

## What not to do

- Do not pair POST-new with DELETE-old under editor rights.
- Do not treat mixed field sharing on one entity as a workaround.

(*MVOX:memkit*)
