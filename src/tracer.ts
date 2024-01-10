type TracerType =
  | "tool"
  | "chain"
  | "llm"
  | "retriever"
  | "embedding"
  | "prompt"
  | "parser";

export type Tracer = {
  sub(
    name: string,
    type: TracerType,
    data: {
      [key: string]: unknown;
    }
  ): Promise<Tracer>;
  error(
    message: string,
    output?: {
      [key: string]: unknown;
    }
  ): Promise<void>;
  get run(): unknown;
  success(output: { [key: string]: unknown }): Promise<void>;
};

// LangSmith RunTree has a very cumbersone API. This function is a wrapper
// to make it easier to use it in this project, as well as to make it easier
// to implement a local debugger when LangSmith is not available.
export async function createLangSmithTracer(
  name: string,
  type: TracerType,
  data: Record<string, unknown>
): Promise<Tracer> {
  const { RunTree } = await import("langsmith");

  const rootRun = new RunTree({
    name: name,
    run_type: type,
    inputs: data,
  });
  await await rootRun.postRun();

  const createTracer = (r: typeof rootRun): Tracer => {
    return {
      async sub(name, type, data) {
        const child = await r.createChild({
          name,
          run_type: type,
          inputs: data,
        });
        await child.postRun();
        return createTracer(child);
      },
      async error(message, output?) {
        await r.end({ error: message, outputs: output });
        await r.patchRun();
      },
      async success(output) {
        await r.end(output);
        await r.patchRun();
      },
      get run() {
        return r;
      }
    };
  };

  return createTracer(rootRun);
}

export async function createDefaultTracer(): Promise<Tracer> {
  const tracer: Tracer = {
    async sub() {
      return tracer;
    },
    async error() {},
    async success() {},
    get run() { return null; }
  };
  return tracer;
}

export async function createConsoleTracer(
  name: string,
  type: TracerType,
  data: Record<string, unknown>
): Promise<Tracer> {
  console.log(`[${type}: ${name}] Running...`);
  return {
    async sub(newName, newType, data) {
      console.log(`[${type}: ${name}] => [${newType}: ${newName}]`);    
      return createConsoleTracer(newName, newType, data);
    },
    async error(message, output?) {
      console.error(`[${type}: ${name}] Error: ${message}`);
      console.debug(JSON.stringify({ input: data, output }, null, 2));
    },
    async success(output) {
      console.log(`[${type}: ${name}] Ok`);
      console.debug(JSON.stringify({ input: data, output }, null, 2));
    },
    get run() { return null; }
  };
}
