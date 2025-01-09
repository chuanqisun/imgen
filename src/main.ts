import { BehaviorSubject, filter, fromEvent, map, merge, Observable, of, switchMap, tap } from "rxjs";
import { type AIBarEventDetail } from "./lib/ai-bar/lib/ai-bar";
import { LlmNode } from "./lib/ai-bar/lib/elements/llm-node";
import type { TogetherAINode } from "./lib/ai-bar/lib/elements/together-ai-node";
import { system, user } from "./lib/ai-bar/lib/message";
import { loadAIBar } from "./lib/ai-bar/loader";
import { $, parseActionEvent, preventDefault, stopPropagation } from "./lib/dom";

import { CodeEditorElement, defineCodeEditorElement } from "./code-editor/code-editor-element";
import type { AzureSttNode } from "./lib/ai-bar/lib/elements/azure-stt-node";
import "./main.css";

loadAIBar();
defineCodeEditorElement();

const llmNode = $<LlmNode>("llm-node")!;
// const xmlPreview = $<HTMLElement>("#xml-preview")!;
const xmlEditor = $<CodeEditorElement>("#xml-editor")!;
const togetherAINode = $<TogetherAINode>("together-ai-node")!;
const promptInput = $<HTMLInputElement>("#prompt")!;
const messageOutput = $<HTMLElement>("#message-output")!;
const imagePrompt = $<HTMLInputElement>("#image-prompt")!;
const imageOutput = $<HTMLImageElement>("#image-output")!;
const azureSttNode = $<AzureSttNode>("azure-stt-node")!;
const talkButton = $<HTMLButtonElement>("#talk")!;

let submissionQueue: string[] = [];

const currentSceneXML = new BehaviorSubject("<scene></scene>");

const renderXML$ = currentSceneXML.pipe(tap((xml) => (xmlEditor.value = xml)));

xmlEditor.addEventListener("change", (e) => {
  const value = (e as CustomEvent<string>).detail;
  currentSceneXML.next(value);
});

talkButton.addEventListener(
  "mousedown",
  (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    azureSttNode.startMicrophone();
    talkButton.textContent = "Hold to talk";
  },
  { once: true },
);

const holdToTalk$ = merge(
  merge(
    fromEvent(talkButton, "keydown").pipe(filter((e) => (e as KeyboardEvent).key === " ")),
    fromEvent(talkButton, "mousedown"),
  ).pipe(
    tap(() => {
      azureSttNode.start();
      talkButton.textContent = "Release to send";
    }),
  ),
  merge(
    fromEvent(talkButton, "keyup").pipe(filter((e) => (e as KeyboardEvent).key === " ")),
    fromEvent(talkButton, "mouseup"),
  ).pipe(
    tap(() => {
      azureSttNode.stop();
      talkButton.textContent = "Hold to talk";
    }),
  ),
);

const submit$ = fromEvent<KeyboardEvent>(promptInput, "keydown").pipe(
  filter((e) => e.key === "Enter"),
  map((e) => promptInput.value),
  filter((v) => v.length > 0),
  tap(() => (promptInput.value = "")),
);

const voiceSubmit$ = fromEvent<CustomEvent<AIBarEventDetail>>(azureSttNode, "event").pipe(
  tap(preventDefault),
  tap(stopPropagation),
  map((e) => (e as CustomEvent<AIBarEventDetail>).detail.recognized?.text as string),
  filter((v) => !!v?.length),
);

function update_by_script(scene$: BehaviorSubject<string>, args: { script: string }) {
  console.log(`[tool] script`, args.script);
  const fn = new Function("document", args.script);
  try {
    const existingXml = scene$.value;
    const doc = new DOMParser().parseFromString(scene$.value, "application/xml");
    fn(doc);
    const xml = new XMLSerializer().serializeToString(doc);
    console.log(`[scene] updated`, { existingXml, newXml: xml });
    scene$.next(xml);
    return `Done`;
  } catch (e) {
    return `Error: ${(e as any).message}`;
  }
}

function rewrite_xml(scene$: BehaviorSubject<string>, args: { xml: string }) {
  console.log(`[tool] rewrite`, args.xml);

  scene$.next(args.xml);
  return `Done`;
}

const updateByScript = update_by_script.bind(null, currentSceneXML);
Object.defineProperty(updateByScript, "name", { value: "update_by_script" }); // protect from bundler mangling
const rewriteXml = rewrite_xml.bind(null, currentSceneXML);
Object.defineProperty(rewriteXml, "name", { value: "rewrite_xml" }); // protect from bundler mangling

const updateScene$ = merge(voiceSubmit$, submit$).pipe(
  map((text) => [...submissionQueue, text]),
  switchMap((inputs) => {
    const sceneXML = currentSceneXML.value;
    console.log({ inputs, sceneXML });
    return new Observable((subscriber) => {
      const llm = llmNode.getClient("aoai");
      const abortController = new AbortController();

      const task = llm.beta.chat.completions.runTools(
        {
          messages: [
            system`
You are a 3D model technical artist. The current scene looks like this:
 
\`\`\`xml
${sceneXML}         
\`\`\`

Syntax guideline
- Be hierarchical and efficient. Add details when asked by user.
- Avoid nesting too much. Prefer simple, obvious tag names.
- Use arbitrary xml tags and attributes. Prefer tags over attributes.
  - Use tags to describe subjects, objects, environments and entities.
  - Use attribute to describe un-materialized property of a tag, such as style, material, lighting.
- Use concise natural language where description is needed.
- Spatial relationship must be explicitly described.

Now update the scene XML based on user provided instructions. You must use one of the following tools:
- update_by_script tool. You need to pass a DOM manipulate javascript to the tool. 
- rewrite_xml. You must rewrite the entire scene xml.

Use exactly one tool. Do NOT say anything after tool use.
`,
            user`${inputs.join("; ")}`,
          ],
          model: "gpt-4o",
          tools: [
            {
              type: "function",
              function: {
                function: updateByScript,
                parse: JSON.parse,
                description: "Update the scene by executing a DOM manipulate javascript",
                parameters: {
                  type: "object",
                  properties: {
                    script: {
                      type: "string",
                      description: "A DOM manipulate javascript. `document` is the root of the scene",
                    },
                  },
                },
              },
            },
            {
              type: "function",
              function: {
                function: rewriteXml,
                parse: JSON.parse,
                description: "Rewrite the entire scene xml",
                parameters: {
                  type: "object",
                  properties: {
                    xml: {
                      type: "string",
                      description: "The new scene xml, top level tag must be <scene>...</scene>",
                    },
                  },
                },
              },
            },
          ],
        },
        {
          signal: abortController.signal,
        },
      );

      task
        .finalContent()
        .then((content) => {
          messageOutput.textContent = content;
          submissionQueue = submissionQueue.filter((v) => !inputs.includes(v));
          subscriber.next(content);
        })
        .catch((e) => console.error(e))
        .finally(() => {
          subscriber.complete();
        });

      return () => abortController.abort();
    });
  }),
);

const imagePrompt$ = currentSceneXML.pipe(
  switchMap((sceneXML) => {
    if (sceneXML === "<scene></scene>") return of("Empty scene");

    return new Observable<string>((subscriber) => {
      const llm = llmNode.getClient("aoai");
      const abortController = new AbortController();
      llm.chat.completions
        .create(
          {
            messages: [
              system`Convert the provided scene XML to a single paragraph of natural language description. Requirements:
- Be thorough. Make sure every tag, attribute, and inner text is incorporated.
- Do not imagine or infer unmentioned details.
- Be concise. Do NOT add narrative or emotional description.
        `,
              user`${sceneXML}`,
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
    if (prompt === "Empty scene") return of("https://placehold.co/400");
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
updateScene$.subscribe();
generateImage$.subscribe();
holdToTalk$.subscribe();
renderXML$.subscribe();
