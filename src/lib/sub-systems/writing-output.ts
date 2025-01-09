// WRITING SUB-SYSTEM

import { fromEvent, Observable, switchMap, tap } from "rxjs";
import type { LlmNode } from "../ai-bar/lib/elements/llm-node";
import { system, user } from "../ai-bar/lib/message";
import { $ } from "../dom";
import { currentWorldXML } from "./shared";

export function useWritingOutput() {
  const writeButton = $<HTMLButtonElement>("#write")!;
  const writingPrompt = $<HTMLInputElement>("#writing-prompt")!;
  const writingPreview = $<HTMLElement>("#writing-preview")!;
  const llmNode = $<LlmNode>("llm-node")!;

  const writingOutput$ = fromEvent(writeButton, "click").pipe(
    switchMap(() => {
      // clear the output first
      writingPreview.textContent = "";

      const llm = llmNode.getClient("aoai");
      const abortController = new AbortController();
      return new Observable<string>((subscriber) => {
        llm.chat.completions
          .create(
            {
              stream: true,
              messages: [
                system`
You are a talented writer. Here is the world knowledge you have:
${currentWorldXML.value}

Based on user's writing prompt, produce the writing based on the world knowledge. Respond in markdown format.
              `,
                user`${writingPrompt.value}`,
              ],
              model: "gpt-4o",
            },
            {
              signal: abortController.signal,
            },
          )
          .then(async (res) => {
            for await (const chunk of res) {
              const text = chunk?.choices[0]?.delta?.content ?? "";
              if (text) subscriber.next(text);
            }
          });

        return () => abortController.abort();
      }).pipe(
        tap((text) => {
          writingPreview.textContent += text;
        }),
      );
    }),
  );

  return writingOutput$;
}
