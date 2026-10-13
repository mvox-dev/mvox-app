# 03 — Ruled dead (not deleted)

Every unit the gates ruled dead. Nothing here is deleted before GATE 3; the sources sit in
`teams/mvox-dev/memory/fallback/` (and the lead's auto-memory fallback) until then. Generated
by `python3 settle.py && python3 dead.py`; the full text of any id regenerates with `split.py`.

Total: 549.

| ruled at | source | count | tiers |
|---|---|---:|---|
| GATE 1 | auto-memory | 4 | dup 1, superseded 3 |
| GATE 1 | bentham.md | 3 | dup 1, history 1, nofit 1 |
| GATE 1 | byrd.md | 53 | history 52, superseded 1 |
| GATE 1 | chore-72-state.md | 7 | history 7 |
| GATE 1 | comenius.md | 40 | dup 2, history 38 |
| GATE 1 | finn.md | 2 | history 1, superseded 1 |
| GATE 1 | pipeline-args/ | 89 | history 89 |
| GATE 1 | research/ | 53 | history 53 |
| GATE 1 | session-mvox19-pickup-log.md | 19 | history 18, superseded 1 |
| GATE 1 | tallis.md | 3 | history 1, superseded 2 |
| GATE 1 | team-lead-archive.md | 114 | history 109, superseded 5 |
| GATE 1 | team-lead.md | 1 | history 1 |
| GATE 1 | test-gaps.md | 2 | current 1, header 1 |
| GATE 1 | victoria.md | 7 | history 7 |
| batch 1A | auto-memory | 6 | fact 1, lesson 4, ruling 1 |
| batch 1A | finn.md | 2 | current 1, fact 1 |
| batch 1A | team-lead-archive.md | 2 | lesson 2 |
| batch 1B | byrd.md | 93 | current 1, fact 15, lesson 73, rule 3, ruling 1 |
| batch 1B | comenius.md | 32 | current 1, header 1, lesson 30 |
| batch 1B | tallis.md | 3 | fact 1, header 2 |
| batch 1B | team-lead-archive.md | 1 | longform 1 |
| batch 1B | victoria.md | 12 | current 6, fact 1, header 1, lesson 3, ruling 1 |
| batch 2 | byrd.md | 1 | lesson 1 |

## Test gaps still holding (batch 1C: dead, no issues; e2e is a product decision)

| gap | evidence |
|---|---|
| Tailwind purge No test verifying dynamic class | No spec on dynamic-class purge found (grep purge/dynamic in specs: none relevant). |
| CHORE-35 Real Entu OAuth flow not E2E testable | No Playwright installed or config; only unit specs for callback exchange. |
| CHORE-35 Loading skeleton appearance not tested | No Playwright; src/lib/loading has routeLoad specs only, no skeleton-appearance check. |
| CHORE-76/77 Responsive nav viewport stacking | No Playwright/e2e dir; no viewport overflow or z-index paint-order specs found. |
| CHORE-78 Mobile library viewport scroll behaviour | No Playwright/e2e; library specs are unit/DOM only, no viewport tests. |
| CHORE-79 Auth guard E2E flow not Playwright-tested | No Playwright; guard.spec.ts and redirect.spec.ts unit-test logic only. |

## Ids by source

- **GATE 1 / auto-memory**: feedback_finn_parallel_research#1, feedback_no_parallel_dispatch#1, project_polyphony_bff_rights_pattern#1, project_seed_data_v4e_clean#1
- **GATE 1 / bentham.md**: bentham#1, bentham#30, bentham#56
- **GATE 1 / byrd.md**: byrd#1, byrd#5, byrd#6, byrd#11, byrd#12, byrd#15, byrd#17, byrd#24, byrd#28, byrd#32, byrd#38, byrd#42, byrd#49, byrd#55, byrd#63, byrd#64, byrd#65, byrd#66, byrd#67, byrd#71, byrd#72, byrd#75, byrd#76, byrd#79, byrd#80, byrd#83, byrd#84, byrd#88, byrd#89, byrd#90, byrd#95, byrd#96, byrd#98, byrd#107, byrd#108, byrd#118, byrd#120, byrd#123, byrd#127, byrd#130, byrd#136, byrd#137, byrd#140, byrd#142, byrd#143, byrd#146, byrd#147, byrd#150, byrd#151, byrd#157, byrd#161, byrd#162, byrd#165
- **GATE 1 / chore-72-state.md**: chore-72-state#1, chore-72-state#2, chore-72-state#3, chore-72-state#4, chore-72-state#5, chore-72-state#6, chore-72-state#7
- **GATE 1 / comenius.md**: comenius#2, comenius#3, comenius#4, comenius#5, comenius#11, comenius#12, comenius#13, comenius#14, comenius#19, comenius#20, comenius#21, comenius#24, comenius#25, comenius#29, comenius#30, comenius#33, comenius#34, comenius#37, comenius#38, comenius#40, comenius#41, comenius#45, comenius#46, comenius#48, comenius#49, comenius#52, comenius#53, comenius#55, comenius#56, comenius#57, comenius#61, comenius#62, comenius#64, comenius#65, comenius#66, comenius#68, comenius#69, comenius#72, comenius#73, comenius#76
- **GATE 1 / finn.md**: finn#1, finn#5
- **GATE 1 / pipeline-args/**: pipeline-args/args-207.json, pipeline-args/args-208-209-211-214.json, pipeline-args/args-212-213-215-217.json, pipeline-args/args-215-217.json, pipeline-args/args-218.json, pipeline-args/args-219.json, pipeline-args/args-220.json, pipeline-args/args-221.json, pipeline-args/args-222.json, pipeline-args/args-224-232.json, pipeline-args/args-234.json, pipeline-args/args-236.json, pipeline-args/args-237.json, pipeline-args/args-238.json, pipeline-args/args-240-239-241.json, pipeline-args/args-242.json, pipeline-args/args-243.json, pipeline-args/args-247.json, pipeline-args/args-248.json, pipeline-args/args-249.json, pipeline-args/args-250.json, pipeline-args/args-251.json, pipeline-args/args-252.json, pipeline-args/args-253.json, pipeline-args/args-255.json, pipeline-args/args-256-277.json, pipeline-args/args-257.json, pipeline-args/args-258.json, pipeline-args/args-259.json, pipeline-args/args-260.json, pipeline-args/args-261.json, pipeline-args/args-261fix.json, pipeline-args/args-262.json, pipeline-args/args-264.json, pipeline-args/args-266.json, pipeline-args/args-267.json, pipeline-args/args-268.json, pipeline-args/args-269.json, pipeline-args/args-271.json, pipeline-args/args-272.json, pipeline-args/args-273.json, pipeline-args/args-275.json, pipeline-args/args-279-288-300.json, pipeline-args/args-280-244.json, pipeline-args/args-283.json, pipeline-args/args-285.json, pipeline-args/args-286.json, pipeline-args/args-287.json, pipeline-args/args-294.json, pipeline-args/args-297-296.json, pipeline-args/args-301-302.json, pipeline-args/args-303-309-310-312-311.json, pipeline-args/args-304-290.json, pipeline-args/args-305.json, pipeline-args/args-307.json, pipeline-args/args-308.json, pipeline-args/args-313.json, pipeline-args/args-315.json, pipeline-args/args-317.json, pipeline-args/args-318.json, pipeline-args/args-318r.json, pipeline-args/args-318r2.json, pipeline-args/args-320.json, pipeline-args/args-321.json, pipeline-args/args-322.json, pipeline-args/args-330.json, pipeline-args/args-331.json, pipeline-args/args-335.json, pipeline-args/args-337.json, pipeline-args/args-338.json, pipeline-args/args-339.json, pipeline-args/args-340.json, pipeline-args/args-341.json, pipeline-args/args-342.json, pipeline-args/args-343.json, pipeline-args/args-343r.json, pipeline-args/args-345.json, pipeline-args/args-346.json, pipeline-args/args-347.json, pipeline-args/args-347r.json, pipeline-args/args-pack-323-328.json, pipeline-args/args-pack-324-328.json, pipeline-args/args-pack-329-323-328.json, pipeline-args/args-pack-330-318-331.json, pipeline-args/args-pack-337-339.json, pipeline-args/args-pack-340-342-343.json, pipeline-args/args-r1-remainder.json, pipeline-args/args-remainder-318-331.json, pipeline-args/args-remainder2-318-331.json
- **GATE 1 / research/**: research/research-207.json, research/research-208-217.json, research/research-218.json, research/research-219.json, research/research-220.json, research/research-221.json, research/research-222.json, research/research-224-232.json, research/research-234.json, research/research-235.json, research/research-236.json, research/research-237.json, research/research-248.json, research/research-249-247-259.json, research/research-256-277.json, research/research-257-242.json, research/research-261.json, research/research-261fix.json, research/research-262.json, research/research-264.json, research/research-266.json, research/research-267.json, research/research-268.json, research/research-269.json, research/research-272-273-271-283.json, research/research-279-288-300.json, research/research-280-244.json, research/research-285.json, research/research-286-275.json, research/research-287.json, research/research-289-inventory.json, research/research-290-277-289.json, research/research-294.json, research/research-297-296.json, research/research-299-298.json, research/research-301-302.json, research/research-303.json, research/research-304.json, research/research-305.json, research/research-307.json, research/research-308.json, research/research-309.json, research/research-311.json, research/research-312.json, research/research-313.json, research/research-316.json, research/research-320.json, research/research-321.json, research/research-323-328-delta.json, research/research-330.json, research/research-331-v2.json, research/research-pilot-238-243.json, research/research-pilot-b-250-255.json
- **GATE 1 / session-mvox19-pickup-log.md**: session-mvox19-pickup-log#1, session-mvox19-pickup-log#2, session-mvox19-pickup-log#3, session-mvox19-pickup-log#6, session-mvox19-pickup-log#7, session-mvox19-pickup-log#9, session-mvox19-pickup-log#10, session-mvox19-pickup-log#11, session-mvox19-pickup-log#12, session-mvox19-pickup-log#13, session-mvox19-pickup-log#14, session-mvox19-pickup-log#16, session-mvox19-pickup-log#17, session-mvox19-pickup-log#18, session-mvox19-pickup-log#20, session-mvox19-pickup-log#21, session-mvox19-pickup-log#22, session-mvox19-pickup-log#25, session-mvox19-pickup-log#26
- **GATE 1 / tallis.md**: tallis#10, tallis#15, tallis#16
- **GATE 1 / team-lead-archive.md**: team-lead-archive#2, team-lead-archive#5, team-lead-archive#7, team-lead-archive#8, team-lead-archive#9, team-lead-archive#10, team-lead-archive#11, team-lead-archive#12, team-lead-archive#13, team-lead-archive#14, team-lead-archive#16, team-lead-archive#17, team-lead-archive#19, team-lead-archive#20, team-lead-archive#21, team-lead-archive#23, team-lead-archive#24, team-lead-archive#25, team-lead-archive#26, team-lead-archive#27, team-lead-archive#28, team-lead-archive#29, team-lead-archive#30, team-lead-archive#31, team-lead-archive#32, team-lead-archive#33, team-lead-archive#34, team-lead-archive#36, team-lead-archive#37, team-lead-archive#38, team-lead-archive#39, team-lead-archive#40, team-lead-archive#41, team-lead-archive#44, team-lead-archive#45, team-lead-archive#46, team-lead-archive#47, team-lead-archive#48, team-lead-archive#49, team-lead-archive#50, team-lead-archive#51, team-lead-archive#52, team-lead-archive#53, team-lead-archive#54, team-lead-archive#55, team-lead-archive#56, team-lead-archive#57, team-lead-archive#58, team-lead-archive#59, team-lead-archive#60, team-lead-archive#62, team-lead-archive#63, team-lead-archive#64, team-lead-archive#65, team-lead-archive#66, team-lead-archive#67, team-lead-archive#68, team-lead-archive#69, team-lead-archive#70, team-lead-archive#71, team-lead-archive#72, team-lead-archive#73, team-lead-archive#74, team-lead-archive#78, team-lead-archive#79, team-lead-archive#80, team-lead-archive#81, team-lead-archive#82, team-lead-archive#83, team-lead-archive#84, team-lead-archive#85, team-lead-archive#87, team-lead-archive#88, team-lead-archive#89, team-lead-archive#90, team-lead-archive#91, team-lead-archive#93, team-lead-archive#94, team-lead-archive#95, team-lead-archive#96, team-lead-archive#97, team-lead-archive#98, team-lead-archive#99, team-lead-archive#100, team-lead-archive#102, team-lead-archive#103, team-lead-archive#104, team-lead-archive#105, team-lead-archive#106, team-lead-archive#107, team-lead-archive#108, team-lead-archive#109, team-lead-archive#110, team-lead-archive#111, team-lead-archive#112, team-lead-archive#113, team-lead-archive#114, team-lead-archive#115, team-lead-archive#116, team-lead-archive#117, team-lead-archive#118, team-lead-archive#119, team-lead-archive#120, team-lead-archive#121, team-lead-archive#122, team-lead-archive#123, team-lead-archive#124, team-lead-archive#125, team-lead-archive#127, team-lead-archive#128, team-lead-archive#129, team-lead-archive#130, team-lead-archive#131, team-lead-archive#132
- **GATE 1 / team-lead.md**: team-lead#3
- **GATE 1 / test-gaps.md**: test-gaps#1, test-gaps#2
- **GATE 1 / victoria.md**: victoria#2, victoria#7, victoria#9, victoria#13, victoria#15, victoria#18, victoria#20
- **batch 1A / auto-memory**: feedback_ultracode_team_roles#1, project_cf_pages_wrangler_vars#1, project_cf_workers_process_env#1, project_pnpm_not_on_path#1, project_polyphony_no_domain_sharing#1, project_wrangler_deploy_auth#1
- **batch 1A / finn.md**: finn#10, finn#12
- **batch 1A / team-lead-archive.md**: team-lead-archive#18, team-lead-archive#92
- **batch 1B / byrd.md**: byrd#2, byrd#3, byrd#4, byrd#7, byrd#8, byrd#9, byrd#10, byrd#13, byrd#14, byrd#16, byrd#18, byrd#19, byrd#20, byrd#21, byrd#22, byrd#23, byrd#26, byrd#27, byrd#30, byrd#31, byrd#33, byrd#34, byrd#35, byrd#36, byrd#37, byrd#39, byrd#40, byrd#41, byrd#44, byrd#45, byrd#46, byrd#48, byrd#50, byrd#51, byrd#52, byrd#53, byrd#54, byrd#56, byrd#57, byrd#58, byrd#59, byrd#60, byrd#61, byrd#62, byrd#69, byrd#70, byrd#73, byrd#74, byrd#77, byrd#78, byrd#81, byrd#82, byrd#85, byrd#86, byrd#87, byrd#92, byrd#93, byrd#94, byrd#97, byrd#99, byrd#101, byrd#102, byrd#103, byrd#104, byrd#105, byrd#106, byrd#110, byrd#111, byrd#114, byrd#115, byrd#116, byrd#117, byrd#119, byrd#121, byrd#122, byrd#124, byrd#125, byrd#126, byrd#128, byrd#131, byrd#132, byrd#134, byrd#141, byrd#145, byrd#148, byrd#153, byrd#154, byrd#155, byrd#156, byrd#158, byrd#159, byrd#163, byrd#164
- **batch 1B / comenius.md**: comenius#1, comenius#7, comenius#8, comenius#9, comenius#10, comenius#15, comenius#16, comenius#17, comenius#18, comenius#22, comenius#23, comenius#26, comenius#27, comenius#28, comenius#31, comenius#32, comenius#35, comenius#36, comenius#39, comenius#42, comenius#44, comenius#47, comenius#50, comenius#51, comenius#54, comenius#59, comenius#63, comenius#67, comenius#70, comenius#71, comenius#74, comenius#75
- **batch 1B / tallis.md**: tallis#1, tallis#2, tallis#13
- **batch 1B / team-lead-archive.md**: team-lead-archive#1
- **batch 1B / victoria.md**: victoria#1, victoria#3, victoria#4, victoria#5, victoria#6, victoria#8, victoria#10, victoria#12, victoria#14, victoria#16, victoria#17, victoria#22
- **batch 2 / byrd.md**: byrd#113

(*MVOX:memkit*)
