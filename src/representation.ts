import {
  BehaviorSubject,
  filter,
  fromEvent,
  map,
  merge,
  Observable,
  of,
  Subscription,
  switchMap,
  tap,
  withLatestFrom,
} from "rxjs";
import z from "zod";
import { type AIBarEventDetail } from "./lib/ai-bar/lib/ai-bar";
import { LlmNode } from "./lib/ai-bar/lib/elements/llm-node";
import type { TogetherAINode } from "./lib/ai-bar/lib/elements/together-ai-node";
import { system, user } from "./lib/ai-bar/lib/message";
import { loadAIBar } from "./lib/ai-bar/loader";
import { $, parseActionEvent, preventDefault, stopPropagation } from "./lib/dom";

import type { AzureSttNode } from "./lib/ai-bar/lib/elements/azure-stt-node";
import { OpenAIRealtimeNode } from "./lib/ai-bar/lib/elements/openai-realtime-node";
import "./main.css";

loadAIBar();

const llmNode = $<LlmNode>("llm-node")!;
const xmlPreview = $<HTMLElement>("#xml-preview")!;
const togetherAINode = $<TogetherAINode>("together-ai-node")!;
const promptInput = $<HTMLInputElement>("#prompt")!;
const messageOutput = $<HTMLElement>("#message-output")!;
const imagePrompt = $<HTMLInputElement>("#image-prompt")!;
const imageOutput = $<HTMLImageElement>("#image-output")!;
const azureSttNode = $<AzureSttNode>("azure-stt-node")!;
const talkButton = $<HTMLButtonElement>("#talk")!;
const renderButton = $<HTMLButtonElement>("#render")!;
const forgetButton = $<HTMLButtonElement>("#forget")!;
const realtimeNode = $<OpenAIRealtimeNode>("openai-realtime-node")!;
const toggleInterviewButton = $<HTMLButtonElement>(`[data-action="start-interview"]`)!;
const interviewPrompt = $<HTMLInputElement>("#interview-prompt")!;
const modelPrompt = $<HTMLInputElement>("#model-prompt")!;
const realtimePushToTalk = $<HTMLButtonElement>("#realtime-push-to-talk")!;

const EMPTY_XML = "<world></world>";
const currentWorldXML = new BehaviorSubject(EMPTY_XML);

let submissionQueue: string[] = [];

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

let interviewInstructionSub: Subscription | null = null;
const instructionUpdate$ = currentWorldXML.pipe(
  tap((xml) => {
    realtimeNode.updateSessionInstructions(`
Conduct an interview to model the user. The interview should be focused on the following goal:
${interviewPrompt.value}
${
  xml === EMPTY_XML
    ? `\nThe starting state of the model is <world></world>. Get started by modeling the <user>`
    : `\nHere is what you have gathered so far:
${xml}\n`
}

Everytime after user speaks, before you respond, you must update the XML with one of the tools:
  - Use the update_by_script tool to programmatically add information to the model with DOM API. Global variable \`world\` represents the <world> node.
  - each update_by_script has its own executation environment. You can re-query nodes with document.querySelector/querySelectorAll each time.
  - Use rewrite_xml tool to perform large updates. The new XML should have <world>...</world> as the top level tag.

Requirements:
${modelPrompt.value ? `- The world model should be related to ${modelPrompt.value}` : "The world model should be detailed and hierarchical."}
- Before you respond, add the new information to the world model to reflect on what you have learned about the user.
- Do NOT remove/overwrite the information you have gathered. Only add to the model.
- You interview style is very concise. Let the user do the talking.
      `);
  }),
);

const interviewControl$ = fromEvent(toggleInterviewButton, "click").pipe(
  map(parseActionEvent),
  tap(async (e) => {
    if (e.action === "start-interview") {
      await realtimeNode.start();
      realtimeNode.muteMicrophone();
      interviewInstructionSub = instructionUpdate$.subscribe();

      realtimeNode
        .addDraftTool({
          name: "update_by_script",
          description: "Update the world model XML by executing a DOM manipulation javascript",
          parameters: z.object({
            script: z
              .string()
              .describe(
                "A DOM manipulation javascript that creates or updates the nodes and their content. global variable `world` is the root node of the world model.",
              ),
          }),
          run: update_by_script.bind(null, currentWorldXML),
        })
        .addDraftTool({
          name: "rewrite_xml",
          description: "Rewrite the entire world xml",
          parameters: z.object({
            xml: z.string().describe("The new scene xml, top level tag must be <world>...</world>"),
          }),
          run: rewrite_xml.bind(null, currentWorldXML),
        })
        .commitDraftTools();

      realtimeNode.appendUserMessage(`Start the interview now by asking me for an intro`).createResponse();

      toggleInterviewButton.textContent = "Stop";
      toggleInterviewButton.setAttribute("data-action", "stop-interview");
    } else {
      interviewInstructionSub?.unsubscribe();
      realtimeNode.stop();
      toggleInterviewButton.textContent = "Start";
      toggleInterviewButton.setAttribute("data-action", "start-interview");
    }
  }),
);

const interviewPushToTalk$ = merge(
  fromEvent(realtimePushToTalk, "mousedown").pipe(
    tap(() => {
      realtimeNode.unmuteMicrophone();
      realtimeNode.textContent = "Release to send";
    }),
  ),
  fromEvent(realtimePushToTalk, "mouseup").pipe(
    tap(() => {
      realtimeNode.muteMicrophone();
      realtimeNode.textContent = "Hold to talk";
    }),
  ),
);

interviewPushToTalk$.subscribe();
interviewControl$.subscribe();

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
  const fn = new Function("document", "world", args.script);
  try {
    const existingXml = scene$.value;
    const doc = new DOMParser().parseFromString(scene$.value, "application/xml");
    fn(doc, doc.querySelector("world")!);
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

const updateByScript = update_by_script.bind(null, currentWorldXML);
Object.defineProperty(updateByScript, "name", { value: "update_by_script" }); // protect from bundler mangling
const rewriteXml = rewrite_xml.bind(null, currentWorldXML);
Object.defineProperty(rewriteXml, "name", { value: "rewrite_xml" }); // protect from bundler mangling

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

const updateWorldModel$ = merge(voiceSubmit$, submit$).pipe(
  map((text) => [...submissionQueue, text]),
  switchMap((inputs) => {
    const sceneXML = currentWorldXML.value;
    console.log({ inputs, sceneXML });
    return new Observable((subscriber) => {
      const llm = llmNode.getClient("aoai");
      const abortController = new AbortController();

      const task = llm.beta.chat.completions.runTools(
        {
          messages: [
            system`
Model the world with XML. The current model is
 
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
- update_by_script tool. You need to pass a DOM manipulation javascript to the tool. 
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
                description: "Update the world model by executing a DOM manipulation javascript",
                parameters: {
                  type: "object",
                  properties: {
                    script: {
                      type: "string",
                      description: "A DOM manipulation javascript. `document` is the root of the world",
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
                description: "Rewrite the entire world xml",
                parameters: {
                  type: "object",
                  properties: {
                    xml: {
                      type: "string",
                      description: "The new scene xml, top level tag must be <world>...</world>",
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

globalClick$.subscribe();
generateImage$.subscribe();
holdToTalk$.subscribe();
renderXML$.subscribe();
// updateWorldModel$.subscribe();
forget$.subscribe();
