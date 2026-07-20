import type { InlineExtension } from "../core/extensions/types.ts";
import askQuestionExtension from "./ask-question.ts";
import kosValidationExtension from "./kos-validation.ts";
import llamaExtension from "./llama/index.ts";

export const builtInExtensions: InlineExtension[] = [
	{ name: "ask_question", factory: askQuestionExtension },
	{ name: "kos-validation", factory: kosValidationExtension, hidden: true },
	{ name: "llama.cpp", factory: llamaExtension, hidden: true },
];
