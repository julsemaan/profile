import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolExecutionMode } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

type TodoMetadataValue = string | number | boolean | null;

type TodoMetadata = Record<string, TodoMetadataValue>;

interface Todo {
	id: number;
	text: string;
	done: boolean;
	metadata?: TodoMetadata;
}

type TodoAction = "list" | "add" | "set_done" | "remove" | "clear";

interface TodoDetails {
	action: TodoAction;
	todos: Todo[];
	nextId: number;
	error?: string;
}

const TodoMetadataSchema = Type.Record(
	Type.String(),
	Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
);

const TodoParams = Type.Object({
	action: StringEnum(["list", "add", "set_done", "remove", "clear"] as const, {
		description: "Todo action to perform",
	}),
	text: Type.Optional(Type.String({ description: "Todo text for add" })),
	id: Type.Optional(Type.Number({ description: "Todo ID for set_done or remove" })),
	metadata: Type.Optional(TodoMetadataSchema),
});

const TODO_ENFORCEMENT_INSTRUCTIONS = `
IMPORTANT: You must use the todo tool to track every task.
- Start each task by creating or updating a todo item.
- Keep todos current as the task progresses.
- Update todos when:
  - beginning a new task
  - changing plan or scope
  - completing meaningful work
- Todo use is required for task tracking, but it does not need to immediately precede every tool call.
- Before using tools for a new task, ensure at least one relevant todo exists.
`;

const TODO_READ_ONLY_TOOLS = new Set(["ls", "find", "grep", "read"]);

function cloneTodos(todos: Todo[]): Todo[] {
	return todos.map((todo) => ({ ...todo }));
}

function summarizeTodos(todos: Todo[]): string {
	if (todos.length === 0) return "No todos";
	return todos.map((todo) => `[${todo.done ? "x" : " "}] #${todo.id}: ${todo.text}`).join("\n");
}

function getSnapshot(action: TodoAction, todos: Todo[], nextId: number, error?: string): TodoDetails {
	return {
		action,
		todos: cloneTodos(todos),
		nextId,
		error,
	};
}

function reconstructState(ctx: ExtensionContext): { todos: Todo[]; nextId: number } {
	let todos: Todo[] = [];
	let nextId = 1;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== "todo") continue;

		const details = message.details as TodoDetails | undefined;
		if (!details) continue;
		todos = cloneTodos(details.todos);
		nextId = details.nextId;
	}

	return { todos, nextId };
}

export default function todoExtension(pi: ExtensionAPI) {
	let todos: Todo[] = [];
	let nextId = 1;
	let todoUpdatedThisTurn = false;

	const syncState = (ctx: ExtensionContext) => {
		const state = reconstructState(ctx);
		todos = state.todos;
		nextId = state.nextId;
	};

	pi.on("session_start", async (_event, ctx) => syncState(ctx));
	pi.on("session_tree", async (_event, ctx) => syncState(ctx));
	pi.on("turn_start", async () => {
		todoUpdatedThisTurn = false;
	});

	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: event.systemPrompt + `\n\n${TODO_ENFORCEMENT_INSTRUCTIONS}`,
		};
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName === "todo") {
			todoUpdatedThisTurn = true;
			return;
		}

		const hasActiveTodos = todos.some((todo) => !todo.done);
		if (hasActiveTodos || todoUpdatedThisTurn || TODO_READ_ONLY_TOOLS.has(event.toolName)) {
			return;
		}

		return {
			block: true,
			reason: "Create or update a todo before continuing this task.",
		};
	});

	pi.registerTool({
		name: "todo",
		label: "Todo",
		description: "Required task-tracking tool for agents. Actions: list, add, set_done, remove, clear.",
		promptSnippet: "Required task-tracking tool. Start tasks with a relevant todo and keep it updated.",
		promptGuidelines: [
			"You must use todo to track every task.",
			"Start each task by creating or updating a todo item.",
			"Keep todos current as the task progresses, especially when beginning a new task, changing scope, or completing meaningful work.",
			"Todo use is required for task tracking, but it does not need to immediately precede every tool call.",
			"Before using tools for a new task, ensure at least one relevant todo exists.",
		],
		parameters: TodoParams,
		executionMode: "sequential" as ToolExecutionMode,

		async execute(_toolCallId, params) {
			switch (params.action) {
				case "list": {
					return {
						content: [{ type: "text", text: summarizeTodos(todos) }],
						details: getSnapshot("list", todos, nextId),
					};
				}

				case "add": {
					const text = params.text?.trim();
					if (!text) {
						return {
							content: [{ type: "text", text: "Error: text is required for add" }],
							details: getSnapshot("add", todos, nextId, "text is required for add"),
						};
					}

					const todo: Todo = { id: nextId++, text, done: false, metadata: params.metadata };
					todos.push(todo);
					return {
						content: [{ type: "text", text: `Added todo #${todo.id}: ${todo.text}` }],
						details: getSnapshot("add", todos, nextId),
					};
				}

				case "set_done": {
					if (params.id === undefined) {
						return {
							content: [{ type: "text", text: "Error: id is required for set_done" }],
							details: getSnapshot("set_done", todos, nextId, "id is required for set_done"),
						};
					}

					const todo = todos.find((item) => item.id === params.id);
					if (!todo) {
						return {
							content: [{ type: "text", text: `Todo #${params.id} not found` }],
							details: getSnapshot("set_done", todos, nextId, `todo #${params.id} not found`),
						};
					}

					if (todo.done) {
						return {
							content: [{ type: "text", text: `Todo #${todo.id} is already done` }],
							details: getSnapshot("set_done", todos, nextId),
						};
					}

					todo.done = true;
					return {
						content: [{ type: "text", text: `Marked todo #${todo.id} done` }],
						details: getSnapshot("set_done", todos, nextId),
					};
				}

				case "remove": {
					if (params.id === undefined) {
						return {
							content: [{ type: "text", text: "Error: id is required for remove" }],
							details: getSnapshot("remove", todos, nextId, "id is required for remove"),
						};
					}

					const index = todos.findIndex((item) => item.id === params.id);
					if (index === -1) {
						return {
							content: [{ type: "text", text: `Todo #${params.id} not found` }],
							details: getSnapshot("remove", todos, nextId, `todo #${params.id} not found`),
						};
					}

					const [removed] = todos.splice(index, 1);
					return {
						content: [{ type: "text", text: `Removed todo #${removed.id}: ${removed.text}` }],
						details: getSnapshot("remove", todos, nextId),
					};
				}

				case "clear": {
					const count = todos.length;
					todos = [];
					nextId = 1;
					return {
						content: [{ type: "text", text: `Cleared ${count} todo${count === 1 ? "" : "s"}` }],
						details: getSnapshot("clear", todos, nextId),
					};
				}

				default:
					return {
						content: [{ type: "text", text: `Unknown action: ${String(params.action)}` }],
						details: getSnapshot("list", todos, nextId, `unknown action: ${String(params.action)}`),
					};
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", String(args.action ?? ""));
			if (typeof args.id === "number") text += ` ${theme.fg("accent", `#${args.id}`)}`;
			if (typeof args.text === "string" && args.text.trim()) text += ` ${theme.fg("dim", JSON.stringify(args.text))}`;
			if (args.metadata && typeof args.metadata === "object") {
				text += ` ${theme.fg("dim", JSON.stringify(args.metadata))}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as TodoDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			if (details.action === "list") {
				if (details.todos.length === 0) {
					return new Text(theme.fg("dim", "No todos"), 0, 0);
				}

				const visible = expanded ? details.todos : details.todos.slice(0, 6);
				const lines = visible.map((todo) => {
					const mark = todo.done ? theme.fg("success", "✓") : theme.fg("dim", "○");
					const text = todo.done ? theme.fg("dim", todo.text) : theme.fg("muted", todo.text);
					return `${mark} ${theme.fg("accent", `#${todo.id}`)} ${text}`;
				});
				if (!expanded && details.todos.length > visible.length) {
					lines.push(theme.fg("dim", `... ${details.todos.length - visible.length} more`));
				}
				return new Text(lines.join("\n"), 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});

	pi.registerCommand("todos", {
		description: "Show the current todo list for this branch",
		handler: async (_args, ctx) => {
			syncState(ctx);
			ctx.ui.notify(summarizeTodos(todos), "info");
		},
	});
}
