import { VitestTestRunner } from "vitest/runners";
import type { File } from "@vitest/runner";
import { setProjectRoot } from "../../src/server/bobbit-dir.js";
import { resetAgentDirStateForTests } from "../../src/server/agent-dir-config.js";

/**
 * Per-file reset of the bobbit-dir project-root and agent-dir runtime
 * singletons for the `isolate: false` node projects (v2-core, v2-integration).
 *
 * Under isolate:false every file in a worker fork shares one module graph, so
 * these process-level singletons leak between files. Several files point them
 * at fixture paths (docker-args.test.ts -> setProjectRoot under
 * `/memfs/docker-args/...`) and never restore them; a later file in the same
 * fork that relies on the defaults then resolves state paths under the leaked
 * fixture root and fails on a real mkdir under `/memfs/...`
 * (mcp-meta-policy: EACCES/ENOENT). Which file loses depends on worker
 * sharding, so it surfaces on CI's core count but not necessarily on the dev
 * box, and retry:3 cannot help — the retry runs in the same
 * still-contaminated fork.
 *
 * Setup-file hooks cannot express this reset: under isolate:false a setup
 * file's `beforeAll` fires once per WORKER (measured: 3 firings across 604
 * files), and `beforeEach` fires after the current file's own `beforeAll`,
 * which would clobber legitimate per-file setup. The runner's
 * `onCollectStart` is the one hook that fires per file BEFORE the file module
 * is imported, so restoring the baseline here gives every file what an
 * isolated fork would: unset project root (cwd fallback) and uninitialized
 * agent-dir state. Files that need other values set them in their own setup,
 * which runs after this hook, and the fork-scoped gateway re-asserts its
 * roots on every getGateway() call.
 *
 * Deliberately NOT reset: process.env. The fork-scoped gateway installs its
 * BOBBIT_* env at boot as intentional fork-wide state (tests2/harness/
 * gateway.ts), and in-process server handlers read it at request time —
 * restoring an env snapshot here breaks later gateway files (observed:
 * search-preview-api artifact-id mismatches under VITEST_MAX_WORKERS=2).
 */
const BASELINE_CWD = process.cwd();

export default class FileBoundaryRunner extends VitestTestRunner {
	onCollectStart(file: File): void {
		setProjectRoot(BASELINE_CWD);
		resetAgentDirStateForTests();
		return super.onCollectStart(file);
	}
}
