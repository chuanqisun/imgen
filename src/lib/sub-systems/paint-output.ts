import { fromEvent, Observable, of, switchMap, tap, withLatestFrom } from "rxjs";
import type { LlmNode } from "../ai-bar/lib/elements/llm-node";
import type { TogetherAINode } from "../ai-bar/lib/elements/together-ai-node";
import { system, user } from "../ai-bar/lib/message";
import { $ } from "../dom";
import { currentWorldXML, EMPTY_XML } from "./shared";

export function usePaintOutput() {
  const visualPrompt = $<HTMLInputElement>("#visual-prompt")!;
  const imagePrompt = $<HTMLInputElement>("#image-prompt")!;
  const imageOutput = $<HTMLImageElement>("#image-output")!;
  const llmNode = $<LlmNode>("llm-node")!;
  const renderButton = $<HTMLButtonElement>("#render")!;
  const togetherAINode = $<TogetherAINode>("together-ai-node")!;

  const imagePrompt$ = fromEvent(renderButton, "click").pipe(
    withLatestFrom(currentWorldXML),
    switchMap(([_, worldXML]) => {
      if (worldXML === EMPTY_XML) return of("Empty");

      return new Observable<string>((subscriber) => {
        const llm = llmNode.getClient("aoai");
        const abortController = new AbortController();
        llm.chat.completions
          .create(
            {
              messages: [
                system`Follow user's instruction to convert the following world model (XML) to a single paragraph of natural language description.

${worldXML}

Requirements:
- Describe the scene systematically. Use user's instruction to determine subject and scene, foreground and background, content and style.
- Do not imagine or infer unmentioned details.
- Be concise. Do NOT add narrative or emotional description.
        `,
                user`Instruction: ${visualPrompt.value.length ? visualPrompt.value : "Faithfully describe the scene. Now describe the scene based on my instruction."}`,
              ],
              model: "gpt-4o",
            },
            { signal: abortController.signal },
          )
          .then((res) => {
            const result = res.choices.at(0)?.message.content;
            if (result) {
              subscriber.next(result);
            }
            subscriber.complete();
          });

        return () => abortController.abort();
      });
    }),
    tap((prompt) => (imagePrompt.textContent = prompt)),
  );

  const generateImage$ = imagePrompt$.pipe(
    switchMap((prompt) => {
      if (prompt === "Empty") return of("https://placehold.co/400");
      const model = $<HTMLSelectElement>("#model")!.value;
      return togetherAINode.generateImageDataURL(prompt, { model });
    }),
    tap((url) => (imageOutput.src = url)),
  );

  return generateImage$;
}
