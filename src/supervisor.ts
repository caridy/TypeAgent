import { Agent } from "./agent";
import { Tracer } from "./tracer";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { AgentExecutor, createOpenAIToolsAgent } from "langchain/agents";
import { HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { Runnable, type RunnableConfig } from "@langchain/core/runnables";
import { JsonOutputToolsParser } from "langchain/output_parsers";
import { BaseMessage } from "@langchain/core/messages";
import { StateGraph, END } from "@langchain/langgraph";
import { Pregel } from "@langchain/langgraph/dist/pregel";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { InputValues } from "@langchain/core/utils/types";

interface AgentStateChannels {
  messages: {
    value: (x: BaseMessage[], y: BaseMessage[]) => BaseMessage[];
    default: () => BaseMessage[];
  };
  next: any; // should this be a string instead?
}

async function createAgent(
  llm: ChatOpenAI, 
  tools: DynamicStructuredTool[], 
  systemPrompt: string
): Promise<Runnable> {
  // Each worker node will be given a name and some tools.
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    new MessagesPlaceholder("messages"),
    new MessagesPlaceholder("agent_scratchpad"),
  ]);
  const agent = await createOpenAIToolsAgent({ llm, tools, prompt });
  return new AgentExecutor({ agent, tools });
}

async function agentNode({ state, agent, name }: {
  state: AgentStateChannels,
  agent: Runnable<any, any, RunnableConfig>,
  name: string
}, config?: RunnableConfig) {
  const result = await agent.invoke(state, config);
  return {
    messages: [
      new HumanMessage({ content: result.output, name })
    ]
  };
}

export class Supervisor {
  #agents = new Map<string, Agent>();
  #maxTurns = 20;
  #supervisorChain: Runnable<InputValues<string>, Record<string, any>, RunnableConfig> | null = null;
  #graph: Pregel | null = null;
  #llm: ChatOpenAI;

  constructor(
    env: Record<string, string | undefined>,
    options?: {
      maxTurns?: number;
    }
  ) {
    if (options?.maxTurns) {
      this.#maxTurns = options.maxTurns;
    }
    this.#llm = new ChatOpenAI({ modelName: env.OPENAI_MODEL as string, temperature: 0, });
  }

  registerAgent(agent: Agent) {
    const { name } = agent;
    this.#agents.set(name, agent);
  }

  async getSuperVisorChain() {
    if (this.#supervisorChain) {
      return this.#supervisorChain;
    }

    const members = [...this.#agents.keys()]; // List of available agents;

    const systemPrompt = (
      "You are a supervisor tasked with managing a conversation between the" +
      " following workers: {members}. Given the following user request," +
      " respond with the worker to act next. Each worker will perform a" +
      " task and respond with their results and status. When finished," +
      " respond with FINISH."
    );
    const options = ["FINISH", ...members];

    // Define the routing function
    const functionDef = {
      name: "route",
      description: "Select the next role.",
      parameters: {
        title: "routeSchema",
        type: "object",
        properties: {
          next: {
            title: "Next",
            anyOf: [
              { enum: options },
            ],
          },
        },
        required: ["next"],
      },
    };
    const toolDef: {
      type: "function",
      function: typeof functionDef
    } = {
        type: "function",
        function: functionDef,
    }

    const prompt = await ChatPromptTemplate.fromMessages([
      ["system", systemPrompt],
      new MessagesPlaceholder("messages"),
      [
        "system",
        "Given the conversation above, who should act next?"
          +" Or should we FINISH? Select one of: {options}",
      ],
    ]).partial({ options: options.join(", "), members: members.join(", ") });

    const supervisorChain = await prompt
      .pipe(this.#llm.bind({tools: [toolDef], tool_choice: {"type": "function", "function": {"name": "route"}}}))
      .pipe(new JsonOutputToolsParser())
      // select the first one
      .pipe((x) => (x[0].args));

    this.#supervisorChain = supervisorChain;

    return supervisorChain;
  }

  async getGraph() {
    if (this.#graph) {
      return this.#graph;
    }

    const members = [...this.#agents.keys()]; // List of available agents;
    const supervisorChain = await this.getSuperVisorChain();
    // This defines the agent state
    const agentStateChannels: AgentStateChannels = {
      messages: {
        value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => [],
      },
      next: 'initialValueForNext', // Replace 'initialValueForNext' with your initial value if needed
    };

    // 1. Create the graph
    const workflow = new StateGraph({
      channels: agentStateChannels,
    });
    // 2. Add the nodes; these will do the work
    workflow.addNode("supervisor", supervisorChain);
    for (const name of members) {
      const agentTool = this.#agents.get(name)!.createAgentAsTool();
      const agent = await createAgent(
        this.#llm,
        [agentTool],
        agentTool.description
      );
      const memberNode = async (state: AgentStateChannels, config?: RunnableConfig | undefined) => await agentNode({
        state, 
        agent, 
        name,
      }, config);
      workflow.addNode(name, memberNode);
      workflow.addEdge(name, "supervisor");
    }

    // When the supervisor returns, route to the agent identified in the supervisor's output
    const conditionalMap: { [key: string]: string } = members.reduce((acc: Record<string, string>, member) => {
        acc[member] = member;
        return acc;
    }, {});
    // Or end work if done
    conditionalMap["FINISH"] = END;

    workflow.addConditionalEdges(
        "supervisor", 
        (x: AgentStateChannels) => x.next,
        conditionalMap,
    );

    workflow.setEntryPoint("supervisor");

    const graph = workflow.compile();
    this.#graph = graph;
    return graph;
  }

  async execute(
    prompt: string,
    parentTracer: Tracer,
    _logStep?: (content: string) => void
  ): Promise<string> {
    const graph = await this.getGraph();
    // get a langchain callback from the langsmith parent tracer when possible
    const callbacks = (parentTracer.run as any).id ? new CallbackManager((parentTracer.run as any).id) : undefined;
    const streamResults = graph.stream(
      {
        messages: [
          new HumanMessage({ content: prompt })
        ]
      },
      // @ts-ignore Callbacks vs CallbackManager: I'm not sure why?
      {
        recursionLimit: this.#maxTurns,
        tags: ["agent", "supervisor"],
        runName: 'AgentSupervisor',
        callbacks
      },
    );

    let result: string;

    for await (const output of await streamResults) {
      if (!output?.__end__){
        const agentName = Reflect.ownKeys(output)[0];
        const messages: HumanMessage[] | undefined = output[agentName]?.messages;
        debugger;
        if (messages) {
          result = messages[0].content as string;
        }
        console.log(agentName);
        console.log('----');
      }
    }
    return result! || "Error: No result found.";
  }

}
