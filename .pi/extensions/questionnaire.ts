import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, Text, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "typebox";

interface QuestionOption {
	value: string;
	label: string;
	description?: string;
}

interface Question {
	id: string;
	label: string;
	prompt: string;
	options: QuestionOption[];
	allowOther: boolean;
}

interface Answer {
	id: string;
	value: string;
	label: string;
	wasCustom: boolean;
	index?: number;
}

interface QuestionnaireResult {
	questions: Question[];
	answers: Answer[];
	cancelled: boolean;
}

type RenderOption = QuestionOption & { isOther?: boolean };

const QuestionOptionSchema = Type.Object({
	value: Type.String({ description: "The value returned when selected" }),
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
});

const QuestionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for this question" }),
	label: Type.Optional(Type.String({ description: "Optional short label for summaries and UI" })),
	prompt: Type.String({ description: "The question to ask the user" }),
	options: Type.Array(QuestionOptionSchema, { description: "Suggested answers for the question" }),
	allowOther: Type.Optional(Type.Boolean({ description: "Allow a custom typed answer (default: true)" })),
});

const QuestionnaireParams = Type.Object({
	questions: Type.Array(QuestionSchema, { description: "Questions to ask in order" }),
});

function normalizeQuestions(
	questions: Array<{
		id: string;
		label?: string;
		prompt: string;
		options: QuestionOption[];
		allowOther?: boolean;
	}>,
): { questions?: Question[]; error?: string } {
	if (questions.length === 0) {
		return { error: "Error: No questions provided" };
	}

	const seenIds = new Set<string>();
	const normalized: Question[] = [];

	for (let i = 0; i < questions.length; i++) {
		const question = questions[i];
		if (!question.id.trim()) {
			return { error: `Error: Question ${i + 1} is missing an id` };
		}
		if (seenIds.has(question.id)) {
			return { error: `Error: Duplicate question id: ${question.id}` };
		}
		seenIds.add(question.id);
		if (question.options.length === 0) {
			return { error: `Error: Question ${question.id} has no options` };
		}
		normalized.push({
			id: question.id,
			label: question.label?.trim() || `Q${i + 1}`,
			prompt: question.prompt,
			options: question.options,
			allowOther: question.allowOther !== false,
		});
	}

	return { questions: normalized };
}

function errorResult(
	message: string,
	questions: Question[] = [],
	answers: Answer[] = [],
): { content: { type: "text"; text: string }[]; details: QuestionnaireResult } {
	return {
		content: [{ type: "text", text: message }],
		details: { questions, answers, cancelled: true },
	};
}

function summarizeAnswers(questions: Question[], answers: Answer[], cancelled: boolean): string {
	const lines = answers.map((answer) => {
		const question = questions.find((item) => item.id === answer.id);
		const prefix = question ? `${question.id} (${question.label})` : answer.id;
		if (answer.wasCustom) {
			return `- ${prefix}: user wrote ${answer.label}`;
		}
		const index = answer.index ? `option ${answer.index}` : "suggested option";
		return `- ${prefix}: user selected ${index} (${answer.label})`;
	});

	if (cancelled) {
		return lines.length > 0 ? `User cancelled the questionnaire. Partial answers:\n${lines.join("\n")}` : "User cancelled the questionnaire.";
	}

	return lines.length > 0 ? `Questionnaire answers:\n${lines.join("\n")}` : "Questionnaire completed with no answers.";
}

function buildOptions(question: Question): RenderOption[] {
	const options: RenderOption[] = [...question.options];
	if (question.allowOther) {
		options.push({ value: "__other__", label: "Type something.", isOther: true });
	}
	return options;
}

async function runRpcFallback(ctx: ExtensionContext, questions: Question[]): Promise<QuestionnaireResult> {
	const answers: Answer[] = [];

	for (const question of questions) {
		const options = buildOptions(question);
		const titleLines = [question.prompt];
		if (question.label) {
			titleLines.unshift(`${question.label}`);
		}
		if (options.some((option) => option.description || option.isOther)) {
			titleLines.push("");
			for (let i = 0; i < options.length; i++) {
				const option = options[i];
				const description = option.isOther
					? "Enter a custom answer"
					: option.description;
				titleLines.push(` ${i + 1}. ${option.label}${description ? ` — ${description}` : ""}`);
			}
		}

		const choiceLabels = options.map((option, index) =>
			option.isOther ? option.label : `${index + 1}. ${option.label}`,
		);
		const selection = await ctx.ui.select(titleLines.join("\n"), choiceLabels);
		if (!selection) {
			return { questions, answers, cancelled: true };
		}

		const selectedIndex = choiceLabels.indexOf(selection);
		const selected = options[selectedIndex];
		if (!selected) {
			return { questions, answers, cancelled: true };
		}

		if (selected.isOther) {
			const value = await ctx.ui.input(question.prompt, "Type something...");
			if (value === undefined) {
				return { questions, answers, cancelled: true };
			}
			const trimmed = value.trim() || "(no response)";
			answers.push({ id: question.id, value: trimmed, label: trimmed, wasCustom: true });
			continue;
		}

		answers.push({
			id: question.id,
			value: selected.value,
			label: selected.label,
			wasCustom: false,
			index: selectedIndex + 1,
		});
	}

	return { questions, answers, cancelled: false };
}

function createQuestionnaireComponent(questions: Question[]) {
	return (tui, theme, _kb, done) => {
		let questionIndex = 0;
		let optionIndex = 0;
		let inputMode = false;
		let cachedLines: string[] | undefined;
		const answers = new Map<string, Answer>();

		const editorTheme: EditorTheme = {
			borderColor: (s) => theme.fg("accent", s),
			selectList: {
				selectedPrefix: (t) => theme.fg("accent", t),
				selectedText: (t) => theme.fg("accent", t),
				description: (t) => theme.fg("muted", t),
				scrollInfo: (t) => theme.fg("dim", t),
				noMatch: (t) => theme.fg("warning", t),
			},
		};
		const editor = new Editor(tui, editorTheme);

		function refresh() {
			cachedLines = undefined;
			tui.requestRender();
		}

		function currentQuestion(): Question {
			return questions[questionIndex];
		}

		function currentOptions(): RenderOption[] {
			return buildOptions(currentQuestion());
		}

		function finish(cancelled: boolean) {
			done({ questions, answers: Array.from(answers.values()), cancelled });
		}

		function saveAnswer(answer: Answer) {
			answers.set(answer.id, answer);
		}

		function advance() {
			if (questionIndex >= questions.length - 1) {
				finish(false);
				return;
			}
			questionIndex++;
			optionIndex = 0;
			inputMode = false;
			editor.setText("");
			refresh();
		}

		editor.onSubmit = (value) => {
			const question = currentQuestion();
			const trimmed = value.trim() || "(no response)";
			saveAnswer({ id: question.id, value: trimmed, label: trimmed, wasCustom: true });
			advance();
		};

		function handleInput(data: string) {
			if (inputMode) {
				if (matchesKey(data, Key.escape)) {
					inputMode = false;
					editor.setText("");
					refresh();
					return;
				}
				editor.handleInput(data);
				refresh();
				return;
			}

			const options = currentOptions();
			const question = currentQuestion();

			if (matchesKey(data, Key.up)) {
				optionIndex = Math.max(0, optionIndex - 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.down)) {
				optionIndex = Math.min(options.length - 1, optionIndex + 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				const selected = options[optionIndex];
				if (selected.isOther) {
					inputMode = true;
					editor.setText("");
					refresh();
					return;
				}
				saveAnswer({
					id: question.id,
					value: selected.value,
					label: selected.label,
					wasCustom: false,
					index: optionIndex + 1,
				});
				advance();
				return;
			}
			if (matchesKey(data, Key.escape)) {
				finish(true);
			}
		}

		function render(width: number): string[] {
			if (cachedLines) return cachedLines;

			const lines: string[] = [];
			const question = currentQuestion();
			const options = currentOptions();
			const add = (text: string) => lines.push(truncateToWidth(text, width));

			add(theme.fg("accent", "─".repeat(width)));
			add(theme.fg("accent", theme.bold(` Question ${questionIndex + 1} of ${questions.length}`)));
			add(theme.fg("muted", ` ${question.label}`));
			lines.push("");
			add(theme.fg("text", ` ${question.prompt}`));
			lines.push("");

			for (let i = 0; i < options.length; i++) {
				const option = options[i];
				const selected = i === optionIndex;
				const prefix = selected ? theme.fg("accent", "> ") : "  ";
				const color = selected ? "accent" : "text";
				const suffix = option.isOther && inputMode ? " ✎" : "";
				add(prefix + theme.fg(color, `${i + 1}. ${option.label}${suffix}`));
				if (option.description) {
					add(`     ${theme.fg("muted", option.description)}`);
				}
			}

			if (questionIndex > 0) {
				lines.push("");
				add(theme.fg("muted", " Previous answers:"));
				for (let i = 0; i < questionIndex; i++) {
					const previousQuestion = questions[i];
					const answer = answers.get(previousQuestion.id);
					if (!answer) continue;
					const prefix = answer.wasCustom ? "(wrote) " : "";
					add(`  ${theme.fg("dim", `${previousQuestion.label}: `)}${theme.fg("text", `${prefix}${answer.label}`)}`);
				}
			}

			if (inputMode) {
				lines.push("");
				add(theme.fg("muted", " Your answer:"));
				for (const line of editor.render(width - 2)) {
					add(` ${line}`);
				}
			}

			lines.push("");
			if (inputMode) {
				add(theme.fg("dim", " Enter to submit • Esc to go back"));
			} else {
				add(theme.fg("dim", " ↑↓ navigate • Enter select • Esc cancel"));
			}
			add(theme.fg("accent", "─".repeat(width)));

			cachedLines = lines;
			return lines;
		}

		return {
			render,
			invalidate: () => {
				cachedLines = undefined;
			},
			handleInput,
		};
	};
}

export default function questionnaire(pi: ExtensionAPI) {
	pi.registerTool({
		name: "questionnaire",
		label: "Questionnaire",
		description: "Ask the user several clarifying questions in one tool call, with suggested answers and optional custom input.",
		promptSnippet: "Ask multiple clarification questions with suggested answers and optional custom input",
		promptGuidelines: [
			"Use questionnaire when you need multiple clarifications from the user before you can proceed.",
			"Use questionnaire instead of asking several plain-text follow-up questions when suggested answers would make the interaction easier.",
		],
		parameters: QuestionnaireParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return errorResult("Error: UI not available (running in non-interactive mode)");
			}

			const normalized = normalizeQuestions(params.questions);
			if (!normalized.questions) {
				return errorResult(normalized.error || "Error: Invalid questionnaire");
			}

			const questions = normalized.questions;
			const interactiveResult = await ctx.ui.custom<QuestionnaireResult | undefined>(
				createQuestionnaireComponent(questions),
			);
			const result = interactiveResult ?? (await runRpcFallback(ctx, questions));
			const summary = summarizeAnswers(questions, result.answers, result.cancelled);

			if (result.cancelled) {
				return {
					content: [{ type: "text", text: summary }],
					details: result,
				};
			}

			return {
				content: [{ type: "text", text: summary }],
				details: result,
			};
		},

		renderCall(args, theme, _context) {
			const questions = Array.isArray(args.questions) ? (args.questions as Array<{ label?: string; id?: string }>) : [];
			const labels = questions.map((question) => question.label || question.id || "?").join(", ");
			let text = theme.fg("toolTitle", theme.bold("questionnaire "));
			text += theme.fg("muted", `${questions.length} question${questions.length === 1 ? "" : "s"}`);
			if (labels) {
				text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as QuestionnaireResult | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.cancelled && details.answers.length === 0) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}
			const lines = details.answers.map((answer) => {
				const prefix = answer.wasCustom
					? theme.fg("muted", "(wrote) ")
					: theme.fg("muted", answer.index ? `(${answer.index}) ` : "");
				return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${prefix}${answer.label}`;
			});
			if (details.cancelled) {
				lines.unshift(theme.fg("warning", "Cancelled"));
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
