<script lang="ts">
	import type { Snippet } from 'svelte';
	const { children }: { children: Snippet } = $props();
</script>

<div data-desk class="w-full wood-bg">
	{@render children()}
</div>

<style>
	/* Registered custom properties so <length> values interpolate cleanly */
	@property --dx1 { syntax: '<length>'; inherits: false; initial-value: 10px; }
	@property --dy1 { syntax: '<length>'; inherits: false; initial-value: 0px; }
	@property --dx2 { syntax: '<length>'; inherits: false; initial-value: -5px; }
	@property --dy2 { syntax: '<length>'; inherits: false; initial-value: 8.66px; }
	@property --dx3 { syntax: '<length>'; inherits: false; initial-value: -5px; }
	@property --dy3 { syntax: '<length>'; inherits: false; initial-value: -8.66px; }

	.wood-bg {
		/* Initial phase positions (each layer 120° apart on r=10px circle) */
		--dx1: 10px;  --dy1: 0px;
		--dx2: -5px;  --dy2: 8.66px;
		--dx3: -5px;  --dy3: -8.66px;

		animation:
			wood-orbit1 8s  linear infinite,
			wood-orbit2 13s linear infinite,
			wood-orbit3 21s linear infinite;

		background:
			/* Ring layer 1 — orbits common center (-4800px, 50%) */
			repeating-radial-gradient(circle at calc(-4800px + var(--dx1)) calc(50% + var(--dy1)),
				rgba(0,0,0,0.06) 0px, rgba(0,0,0,0.06) 1px,
				transparent       1px, transparent       14px,
				rgba(0,0,0,0.04) 14px, rgba(0,0,0,0.04) 15px,
				transparent       15px, transparent       28px),

			/* Ring layer 2 */
			repeating-radial-gradient(circle at calc(-4800px + var(--dx2)) calc(50% + var(--dy2)),
				rgba(0,0,0,0.05) 0px, rgba(0,0,0,0.05) 1px,
				transparent       1px, transparent       7px,
				rgba(0,0,0,0.03) 7px, rgba(0,0,0,0.03) 8px,
				transparent       8px, transparent       18px),

			/* Ring layer 3 */
			repeating-radial-gradient(circle at calc(-4800px + var(--dx3)) calc(50% + var(--dy3)),
				rgba(0,0,0,0.04) 0px, rgba(0,0,0,0.04) 2px,
				transparent       2px, transparent       38px),

			/* Static knot/mark layers */
			radial-gradient(ellipse 280px 80px at 18% 12%, rgba(0,0,0,0.08), transparent 70%),
			radial-gradient(ellipse 160px 50px at 78% 35%, rgba(0,0,0,0.06), transparent 70%),
			radial-gradient(ellipse 220px 70px at 50% 70%, rgba(0,0,0,0.06), transparent 70%),
			radial-gradient(ellipse 180px 50px at 22% 92%, rgba(0,0,0,0.05), transparent 70%),

			/* Base warm cream→peach tone (S33 §4.1 PO color swap) */
			linear-gradient(180deg, #f7ecd4, #f7dcca);
		background-attachment: fixed;
	}

	/* Each layer's (dx, dy) traces a circle of r=10px around (0,0) — 12-point orbit (every 30°) */
	@keyframes wood-orbit1 {
		0%       { --dx1: 10.00px;  --dy1: 0.00px;  }
		8.333%   { --dx1: 8.66px;   --dy1: 5.00px;  }
		16.667%  { --dx1: 5.00px;   --dy1: 8.66px;  }
		25%      { --dx1: 0.00px;   --dy1: 10.00px; }
		33.333%  { --dx1: -5.00px;  --dy1: 8.66px;  }
		41.667%  { --dx1: -8.66px;  --dy1: 5.00px;  }
		50%      { --dx1: -10.00px; --dy1: 0.00px;  }
		58.333%  { --dx1: -8.66px;  --dy1: -5.00px; }
		66.667%  { --dx1: -5.00px;  --dy1: -8.66px; }
		75%      { --dx1: 0.00px;   --dy1: -10.00px;}
		83.333%  { --dx1: 5.00px;   --dy1: -8.66px; }
		91.667%  { --dx1: 8.66px;   --dy1: -5.00px; }
		100%     { --dx1: 10.00px;  --dy1: 0.00px;  }
	}
	@keyframes wood-orbit2 {
		0%       { --dx2: -5.00px;  --dy2: 8.66px;  }
		8.333%   { --dx2: -8.66px;  --dy2: 5.00px;  }
		16.667%  { --dx2: -10.00px; --dy2: 0.00px;  }
		25%      { --dx2: -8.66px;  --dy2: -5.00px; }
		33.333%  { --dx2: -5.00px;  --dy2: -8.66px; }
		41.667%  { --dx2: 0.00px;   --dy2: -10.00px;}
		50%      { --dx2: 5.00px;   --dy2: -8.66px; }
		58.333%  { --dx2: 8.66px;   --dy2: -5.00px; }
		66.667%  { --dx2: 10.00px;  --dy2: 0.00px;  }
		75%      { --dx2: 8.66px;   --dy2: 5.00px;  }
		83.333%  { --dx2: 5.00px;   --dy2: 8.66px;  }
		91.667%  { --dx2: 0.00px;   --dy2: 10.00px; }
		100%     { --dx2: -5.00px;  --dy2: 8.66px;  }
	}
	@keyframes wood-orbit3 {
		0%       { --dx3: -5.00px;  --dy3: -8.66px; }
		8.333%   { --dx3: 0.00px;   --dy3: -10.00px;}
		16.667%  { --dx3: 5.00px;   --dy3: -8.66px; }
		25%      { --dx3: 8.66px;   --dy3: -5.00px; }
		33.333%  { --dx3: 10.00px;  --dy3: 0.00px;  }
		41.667%  { --dx3: 8.66px;   --dy3: 5.00px;  }
		50%      { --dx3: 5.00px;   --dy3: 8.66px;  }
		58.333%  { --dx3: 0.00px;   --dy3: 10.00px; }
		66.667%  { --dx3: -5.00px;  --dy3: 8.66px;  }
		75%      { --dx3: -8.66px;  --dy3: 5.00px;  }
		83.333%  { --dx3: -10.00px; --dy3: 0.00px;  }
		91.667%  { --dx3: -8.66px;  --dy3: -5.00px; }
		100%     { --dx3: -5.00px;  --dy3: -8.66px; }
	}
</style>
