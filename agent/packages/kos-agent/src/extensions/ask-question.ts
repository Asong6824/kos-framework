import { Type } from "typebox";
import type { ExtensionAPI } from "../core/extensions/types.ts";

const OptionSchema = Type.Object({
	label: Type.String({ description: "Short option label shown to the user" }),
	description: Type.Optional(Type.String({ description: "Concise explanation of the option's impact" })),
});

const QuestionSchema = Type.Object({
	header: Type.String({ description: "Short identifier for this question" }),
	question: Type.String({ description: "The complete question to ask" }),
	options: Type.Optional(Type.Array(OptionSchema, { description: "Two or more suggested answers" })),
});

const AskQuestionParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		maxItems: 4,
		description: "Questions to ask in order",
	}),
});

interface AskQuestionDetails {
	answers: Record<string, string>;
	cancelled: boolean;
}

/**
 * RPC-capable adaptation of Pi's question/questionnaire extension examples.
 * It deliberately uses the portable select/input UI methods instead of TUI custom components.
 */
export default function askQuestionExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ask_question",
		label: "Ask question",
		description:
			"Ask the user up to four focused questions when their judgment or missing information is needed. This pauses execution until the user answers or cancels.",
		promptSnippet: "Ask the user focused questions and wait for their answers",
		promptGuidelines: [
			"Use ask_question for genuine user judgment or missing information, not as an approval gate for routine file or command operations.",
		],
		parameters: AskQuestionParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const answers: Record<string, string> = {};
			for (const question of params.questions) {
				if (signal?.aborted) {
					return {
						content: [{ type: "text", text: "Question cancelled because the agent run was aborted." }],
						details: { answers, cancelled: true } satisfies AskQuestionDetails,
					};
				}

				const options = question.options ?? [];
				let answer: string | undefined;
				if (options.length > 0) {
					const labels = options.map((option) =>
						option.description ? `${option.label} - ${option.description}` : option.label,
					);
					labels.push("Other (type an answer)");
					const selected = await ctx.ui.select(question.question, labels, { signal });
					if (selected === "Other (type an answer)") {
						answer = await ctx.ui.input(question.question, "Type your answer", { signal });
					} else if (selected) {
						const selectedIndex = labels.indexOf(selected);
						answer = selectedIndex >= 0 && selectedIndex < options.length ? options[selectedIndex].label : selected;
					}
				} else {
					answer = await ctx.ui.input(question.question, "Type your answer", { signal });
				}

				if (answer === undefined) {
					return {
						content: [{ type: "text", text: "User cancelled the question." }],
						details: { answers, cancelled: true } satisfies AskQuestionDetails,
					};
				}
				answers[question.header] = answer;
			}

			return {
				content: [{ type: "text", text: `User answers:\n${JSON.stringify(answers, null, 2)}` }],
				details: { answers, cancelled: false } satisfies AskQuestionDetails,
			};
		},
	});
}
