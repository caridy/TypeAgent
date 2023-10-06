// This module is an abstraction over RunTree from LangSmith package.

export type Tracer = {
  postRun(): Promise<void>;
  patchRun(): Promise<void>;
  createChild(options: {
    name: string;
    run_type: string;
    inputs: {
      [key: string]: unknown;
    };
  }): Promise<Tracer>;
  end(options: {
    error?: string,
    outputs: {
      [key: string]: unknown;
    };
  }): Promise<void>;
};

export async function createRootRun(prompt: string, serialized: {
  agents: string[];
  maxTurns: number;
}): Promise<Tracer> {
  const { RunTree } = await import("langsmith");
  const rootRun = new RunTree({
    name: "Orchestrator",
    run_type: "chain",
    inputs: {
      prompt,
    },
    // Serialized representation of this chain
    serialized,
  });
  return rootRun;
}

export type TracerNew = {
  createChild(
    name: string,
    type: string,
    input: {
      [key: string]: unknown;
    },
  ): Promise<TracerNew>;
  error(message: string, output?: {
    [key: string]: unknown;
  }): Promise<void>;
  done(output: {
    [key: string]: unknown;
  }): Promise<void>;
};

export async function createTracer(prompt: string, serialized: {
  agents: string[];
  maxTurns: number;
}): Promise<TracerNew> {
  const { RunTree } = await import("langsmith");

  const rootRun = new RunTree({
    name: "Orchestrator",
    run_type: "chain",
    inputs: {
      prompt,
    },
    // Serialized representation of this chain
    serialized,
  });

  // LangSmith RunTree has a very cumbersone API. This function is a wrapper
  // to make it easier to use it in this project, as well as to make it easier
  // to implement a local debugger when LangSmith is not available.
  const createLandSmithTracer = (r: typeof rootRun): TracerNew => {
    return {
      async createChild(
        name: string,
        type: string,
        input: {
          [key: string]: unknown;
        },
      ): Promise<TracerNew> {
        const child = await r.createChild({ name, run_type: type, inputs: input });
        await child.postRun();
        return createLandSmithTracer(child);
      },
      async error(message: string, output?: {
        [key: string]: unknown;
      }): Promise<void> {
        await r.end({ error: message, outputs: output });
        await r.patchRun();
      },
      async done(output: {
        [key: string]: unknown;
      }): Promise<void> {
        await r.end({ outputs: output });
        await r.patchRun();
      },
    };
  };

  return createLandSmithTracer(rootRun);
}
