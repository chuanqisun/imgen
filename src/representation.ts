import { filter, fromEvent, map, merge, Observable, of, switchMap, tap, withLatestFrom } from "rxjs";
import { type AIBarEventDetail } from "./lib/ai-bar/lib/ai-bar";
import { LlmNode } from "./lib/ai-bar/lib/elements/llm-node";
import type { TogetherAINode } from "./lib/ai-bar/lib/elements/together-ai-node";
import { system, user } from "./lib/ai-bar/lib/message";
import { loadAIBar } from "./lib/ai-bar/loader";
import { $, parseActionEvent, preventDefault, stopPropagation } from "./lib/dom";

import type { AzureSttNode } from "./lib/ai-bar/lib/elements/azure-stt-node";
import { useDictateInput } from "./lib/sub-systems/dictate-input";
import { useInterviewInput } from "./lib/sub-systems/interview-input";
import { currentWorldXML, EMPTY_XML } from "./lib/sub-systems/shared";
import { useWritingOutput } from "./lib/sub-systems/writing-output";
import "./main.css";

loadAIBar();

const llmNode = $<LlmNode>("llm-node")!;
const xmlPreview = $<HTMLElement>("#xml-preview")!;
const togetherAINode = $<TogetherAINode>("together-ai-node")!;
const imagePrompt = $<HTMLInputElement>("#image-prompt")!;
const imageOutput = $<HTMLImageElement>("#image-output")!;
const azureSttNode = $<AzureSttNode>("azure-stt-node")!;
const renderButton = $<HTMLButtonElement>("#render")!;
const forgetButton = $<HTMLButtonElement>("#forget")!;

const renderXML$ = currentWorldXML.pipe(tap((xml) => (xmlPreview.textContent = xml)));

const forget$ = fromEvent(forgetButton, "click").pipe(tap(() => currentWorldXML.next(EMPTY_XML)));

// delegated push to talk
let sttTargetElement: HTMLInputElement | null = null;

const delegatedPushToTalk$ = merge(
  fromEvent(document, "mousedown").pipe(
    map(parseActionEvent),
    filter((e) => e.action === "talk"),
    tap((e) => {
      (e.trigger as HTMLButtonElement).textContent = "Send";
      azureSttNode.start();
      sttTargetElement = $<HTMLInputElement>(`#${(e.trigger as HTMLElement).getAttribute("data-talk") ?? ""}`) ?? null;
    }),
  ),
  fromEvent(document, "mouseup").pipe(
    map(parseActionEvent),
    filter((e) => e.action === "talk"),
    tap((e) => {
      (e.trigger as HTMLButtonElement).textContent = "Talk";
      azureSttNode.stop();
    }),
  ),
);

const delegatedRecognition$ = fromEvent<CustomEvent<AIBarEventDetail>>(azureSttNode, "event").pipe(
  tap(preventDefault),
  tap(stopPropagation),
  map((e) => (e as CustomEvent<AIBarEventDetail>).detail.recognized?.text as string),
  filter((v) => !!v?.length),
  tap((text) => {
    if (!sttTargetElement) return;
    if (sttTargetElement.value) text = sttTargetElement.value + " " + text;
    sttTargetElement.value = text;
  }),
);

merge(delegatedPushToTalk$, delegatedRecognition$).subscribe();

// INTERVIEW SUB-SYSTEM
const interviewInput$ = useInterviewInput({ currentWorldXML });
interviewInput$.subscribe();

// WRITING SUB-SYSTEM
const writingOutput$ = useWritingOutput({ currentWorldXML });
writingOutput$.subscribe();

// DICTATE SUB-SYSTEM
const dictateInput$ = useDictateInput();
dictateInput$.subscribe();

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
              system`Convert the provided world XML to a single paragraph of natural language description. Requirements:
- Describe the scene systematically, including subject and scene, foreground and background, content and style.
- Do not imagine or infer unmentioned details.
- Be concise. Do NOT add narrative or emotional description.
        `,
              user`${worldXML}`,
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

const globalClick$ = fromEvent(document, "click").pipe(
  map(parseActionEvent),
  filter((e) => e.action !== null),
  tap(async (e) => {
    switch (e.action) {
    }
  }),
);

globalClick$.subscribe();
generateImage$.subscribe();
renderXML$.subscribe();
forget$.subscribe();
