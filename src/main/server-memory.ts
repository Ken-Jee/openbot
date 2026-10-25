import { readdir, readFile, readlink, writeFile } from "node:fs/promises";
import { Deferred, Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";
import type { HostMemory, HostMemoryLevel } from "../backend/host-memory";

const SAMPLE_INTERVAL_MS = 5_000;
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
/** A turn that starts counts this much until its provider processes have grown. */
const TURN_RESERVE_BYTES = 300 * MIB;
const TURN_RESERVE_MS = 60_000;
/** A low level goes back to "ok" only this far above the low threshold, so it does not flap. */
const RECOVER_MARGIN_BYTES = 256 * MIB;
/**
 * `openbot.service` starts main at -500, and a container starts it at 0. Each process that main starts
 * gets this value, so the OOM killer picks a provider CLI, an MCP server or an agent tool before main.
 */
const CHILD_OOM_SCORE_ADJ = 500;
const PROC_READ_CONCURRENCY = 16;

export interface ServerMemoryOptions {
  /** True on a hosted server, whose plan sets the memory. */
  hostedPlan: boolean;
  /** Called one time when the memory files cannot be read (the level then stays "ok"), and when a listener fails. */
  onError: (message: string, error: unknown) => void;
  now?: () => number;
}

export interface MemorySample {
  /** The effective memory ceiling: the smaller of the machine memory and the cgroup limit. */
  total: number;
  available: number;
}

/**
 * Owns the memory reading of a hosted, self-hosted or container server. Every 5 seconds it reads the
 * memory of its cgroup (v2), such as the systemd unit or the container, and of the machine, and gives
 * each new child process of main a high OOM value. The backend reads the level through `HostMemory`
 * and holds new turns while it is not "ok". The desktop app does not use it.
 */
export class ServerMemory implements HostMemory {
  readonly #options: ServerMemoryOptions;
  readonly #listeners = new Set<() => void>();
  /** The start times of the turns reserved in the last `TURN_RESERVE_MS`. Each one is its own object, so its release removes only it. */
  readonly #reservations = new Set<{ at: number }>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #pending: Deferred.Deferred<void> | null = null;
  #sample: MemorySample | null = null;
  #level: HostMemoryLevel = "ok";
  #readErrorLogged = false;
  #noCgroupLogged = false;

  readonly hostedPlan: boolean;

  constructor(options: ServerMemoryOptions) {
    this.#options = options;
    this.hostedPlan = options.hostedPlan;
  }

  start(): void {
    if (this.#timer) return;
    void Effect.runPromise(this.tick());
    this.#timer = setInterval(() => void Effect.runPromise(this.tick()), SAMPLE_INTERVAL_MS);
    this.#timer.unref();
  }

  stop(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.#timer) clearInterval(this.#timer);
      this.#timer = null;
      return this.#pending ? Deferred.await(this.#pending) : Effect.void;
    });
  }

  level(): HostMemoryLevel {
    return this.#level;
  }

  /** The last reading, or null before the first one and when the memory files cannot be read. */
  sample(): MemorySample | null {
    return this.#sample;
  }

  turnLimit(): 2 | 8 | 16 {
    // A margin over the plan sizes of 4 and 8 GB: the kernel keeps some memory for itself. On 4 GB,
    // four turns that start together reserve enough `TURN_RESERVE_BYTES` to reach the low level.
    const total = this.#sample?.total ?? 0;
    if (total <= 5 * GIB) return 2;
    if (total <= 10 * GIB) return 8;
    return 16;
  }

  reserveTurn(): () => void {
    const reservation = { at: this.#now() };
    this.#reservations.add(reservation);
    this.#level = this.#nextLevel();
    return () => {
      if (this.#reservations.delete(reservation)) this.#level = this.#nextLevel();
    };
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  tick(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.#pending) return Deferred.await(this.#pending);
      const pending = Deferred.makeUnsafe<void>();
      this.#pending = pending;
      return this.#tick().pipe(
        Effect.onExit((exit) =>
          Effect.gen({ self: this }, function* () {
            this.#pending = null;
            yield* Deferred.done(pending, exit);
          }),
        ),
      );
    }).pipe(Effect.uninterruptible);
  }

  #tick = Effect.fn("ServerMemory.tick")(function* (this: ServerMemory) {
    this.#sample = yield* this.#read();
    this.#level = this.#nextLevel();
    yield* raiseChildOomScores();
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (error) {
        this.#options.onError("A server memory listener failed.", error);
      }
    }
  });

  #read = Effect.fn("ServerMemory.read")(function* (this: ServerMemory) {
    const result = yield* Effect.result(
      Effect.gen(function* () {
        const text = yield* memoryIO(() => readFile("/proc/meminfo", "utf8"));
        const machine = yield* Effect.try({
          try: () => parseMeminfo(text),
          catch: (cause) => new HostMemoryFailure({ cause }),
        });
        const unit = yield* readUnitMemory();
        if (typeof unit === "string") return { sample: machine, unit };
        return {
          sample: {
            total: Math.min(machine.total, unit.max),
            available: Math.min(machine.available, Math.max(0, unit.max - unit.current)),
          },
          unit: "limited" as const,
        };
      }),
    );
    if (result._tag === "Success") {
      if (result.success.unit === "unknown" && !this.#noCgroupLogged) {
        this.#noCgroupLogged = true;
        // In a container on cgroup v1, the machine memory is the memory of the host, not the limit.
        this.#options.onError(
          "The server has no cgroup v2 memory limit to read. The memory guard uses the machine memory.",
          null,
        );
      }
      return result.success.sample;
    }
    if (!this.#readErrorLogged) {
      this.#readErrorLogged = true;
      this.#options.onError("The server could not read its memory use.", result.failure.cause);
    }
    return null;
  });

  #nextLevel(): HostMemoryLevel {
    const sample = this.#sample;
    if (!sample) return "ok";
    const now = this.#now();
    for (const reservation of this.#reservations) {
      if (now - reservation.at >= TURN_RESERVE_MS) this.#reservations.delete(reservation);
    }
    if (sample.available < Math.max(256 * MIB, sample.total * 0.06)) return "critical";
    const free = sample.available - this.#reservations.size * TURN_RESERVE_BYTES;
    const low = Math.max(512 * MIB, sample.total * 0.12);
    if (free < low) return "low";
    if (this.#level !== "ok" && free < low + RECOVER_MARGIN_BYTES) return "low";
    return "ok";
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}

function parseMeminfo(text: string): MemorySample {
  const kib = (name: string): number => {
    const match = new RegExp(`^${name}:\\s+(\\d+) kB$`, "m").exec(text);
    if (!match?.[1]) throw new Error(`/proc/meminfo has no ${name}.`);
    return Number(match[1]) * 1024;
  };
  return { total: kib("MemTotal"), available: kib("MemAvailable") };
}

/**
 * The limit and the use of main's cgroup, with no reclaimable file cache. "unlimited" when the cgroup
 * has no limit, and "unknown" when there is no cgroup v2 memory controller to read (cgroup v1 or a
 * hybrid hierarchy).
 */
const readUnitMemory = Effect.fn("ServerMemory.readUnit")(function* () {
  const cgroup = (yield* memoryIO(() => readFile("/proc/self/cgroup", "utf8")))
    .split("\n")
    .find((line) => line.startsWith("0::"));
  if (!cgroup) return "unknown";
  // A container with its own cgroup namespace sees "0::/", and its limit at /sys/fs/cgroup/memory.max.
  const root = `/sys/fs/cgroup${cgroup.slice(3)}`;
  // Only a missing file means no memory controller. Another failure is a read error.
  const max = (yield* memoryIO(() => readFile(`${root}/memory.max`, "utf8")).pipe(
    Effect.catchIf(
      ({ cause }) => cause instanceof Error && "code" in cause && cause.code === "ENOENT",
      () => Effect.succeed(null),
    ),
  ))?.trim();
  if (max === undefined) return "unknown";
  if (max === "max") return "unlimited";
  const current = Number((yield* memoryIO(() => readFile(`${root}/memory.current`, "utf8"))).trim());
  // `memory.current` counts the file cache too. The kernel takes the inactive part back before the
  // OOM killer acts, so it is free memory, as it is in `MemAvailable`.
  const inactiveFile = /^inactive_file (\d+)$/m.exec(
    yield* memoryIO(() => readFile(`${root}/memory.stat`, "utf8")),
  )?.[1];
  return { max: Number(max), current: current - Number(inactiveFile ?? 0) };
});

/**
 * Gives each descendant of main, other than the Electron processes, at least `CHILD_OOM_SCORE_ADJ`.
 * A process can end during the walk, so each read and write can fail and is ignored.
 *
 * An Electron process runs the same binary as main. Chromium sets the values of its renderers and GPU
 * process itself, and the zygotes and the GPU broker keep the value of main (-500 in the unit, 0 in a
 * container). `app.getAppMetrics()` does
 * not list the zygotes or the broker, so the binary is the test: with 500, the OOM killer could kill a
 * zygote, and then no new renderer can start.
 */
const raiseChildOomScores = Effect.fn("ServerMemory.raiseChildOomScores")(function* () {
  const electron = yield* optionalMemoryIO(() => readlink("/proc/self/exe"));
  const children = new Map<number, number[]>();
  const entries = yield* optionalMemoryIO(() => readdir("/proc"));
  yield* Effect.forEach(
    entries ?? [],
    (entry) =>
      Effect.gen(function* () {
        if (!/^\d+$/.test(entry)) return;
        const stat = yield* optionalMemoryIO(() => readFile(`/proc/${entry}/stat`, "utf8"));
        if (stat === null) return;
        // The name can hold spaces, so the fields start after the last ")".
        const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
        if (!Number.isInteger(parent)) return;
        const siblings = children.get(parent) ?? [];
        siblings.push(Number(entry));
        children.set(parent, siblings);
      }),
    // A self-hosted machine can have thousands of processes. Each read holds a file descriptor.
    { concurrency: PROC_READ_CONCURRENCY, discard: true },
  );
  const descendants: number[] = [];
  const pending = [...(children.get(process.pid) ?? [])];
  for (let pid = pending.pop(); pid !== undefined; pid = pending.pop()) {
    descendants.push(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  yield* Effect.forEach(
    descendants,
    (pid) =>
      Effect.gen(function* () {
        if (electron === null || (yield* optionalMemoryIO(() => readlink(`/proc/${pid}/exe`))) === electron) return;
        const path = `/proc/${pid}/oom_score_adj`;
        const text = yield* optionalMemoryIO(() => readFile(path, "utf8"));
        if (text !== null && Number(text.trim()) < CHILD_OOM_SCORE_ADJ) {
          yield* optionalMemoryIO(() => writeFile(path, String(CHILD_OOM_SCORE_ADJ)));
        }
      }),
    { concurrency: "unbounded", discard: true },
  );
});

class HostMemoryFailure extends Schema.TaggedError<HostMemoryFailure>()("HostMemoryFailure", {
  cause: Schema.Defect(),
}) {}

const { io: memoryIO } = causeHelpers(HostMemoryFailure);

function optionalMemoryIO<A>(operation: () => Promise<A>): Effect.Effect<A | null> {
  return memoryIO(operation).pipe(Effect.catch(() => Effect.succeed(null)));
}
