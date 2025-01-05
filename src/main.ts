import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  fromEvent,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  scan,
  switchMap,
  tap,
} from "rxjs";
import { type AIBarEventDetail } from "./lib/ai-bar/lib/ai-bar";
import { LlmNode } from "./lib/ai-bar/lib/elements/llm-node";
import type { TogetherAINode } from "./lib/ai-bar/lib/elements/together-ai-node";
import { system, user } from "./lib/ai-bar/lib/message";
import { loadAIBar } from "./lib/ai-bar/loader";
import { $, parseActionEvent, preventDefault, stopPropagation } from "./lib/dom";

import type { AzureSttNode } from "./lib/ai-bar/lib/elements/azure-stt-node";
import { CameraNode } from "./lib/ai-bar/lib/elements/camera-node";
import "./main.css";

loadAIBar();

const cameraNode = $<CameraNode>("camera-node")!;
const llmNode = $<LlmNode>("llm-node")!;
const xmlPreview = $<HTMLElement>("#xml-preview")!;
const togetherAINode = $<TogetherAINode>("together-ai-node")!;
const promptInput = $<HTMLInputElement>("#prompt")!;
const messageOutput = $<HTMLElement>("#message-output")!;
const imagePrompt = $<HTMLInputElement>("#image-prompt")!;
const imageOutput = $<HTMLImageElement>("#image-output")!;
const azureSttNode = $<AzureSttNode>("azure-stt-node")!;
const talkButton = $<HTMLButtonElement>("#talk")!;
const camToggle = $<HTMLButtonElement>("#cam-toggle")!;
const camDescription = $<HTMLDivElement>("#cam-description")!;
const camTaskCountDisplay = $<HTMLDivElement>("#cam-task-count")!;

let submissionQueue: string[] = [];

const currentSceneXML = new BehaviorSubject("<scene></scene>");

const renderXML$ = currentSceneXML.pipe(tap((xml) => (xmlPreview.textContent = xml)));

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

const camToggle$ = fromEvent(camToggle, "click").pipe(
  tap((e) => {
    if ((e.target as HTMLButtonElement).textContent === "Start camera") {
      cameraNode.start();
      currentSceneXML.next("<scene></scene>");
      camToggle.textContent = "Stop camera";
    } else {
      cameraNode.stop();
      camToggle.textContent = "Start camera";
    }
  }),
);

const camTaskCount = new BehaviorSubject(0);
const camTaskCountDisplay$ = camTaskCount.pipe(
  tap((count) => {
    camTaskCountDisplay.textContent = `${count}`;
  }),
);

const frameChanges$ = fromEvent(cameraNode, "framechange").pipe(
  map(() => cameraNode.capture()),
  mergeMap(async (image) => {
    const startedAt = Date.now();
    const llm = llmNode.getClient("aoai");
    camTaskCount.next(camTaskCount.value + 1);
    const response = await llm.chat.completions
      .create({
        messages: [
          system`Describe the image provided by the user. Respond in the following xml format:
<image>
  <subject>describe any people/object in the image</subject>
  <scene>desribe any environment, location, background</scene>
  <style>describe style of the image. If it's a photo, describe camera angle, film type, lens, lighting; if painting, describe material, technique, genre etc.</style>,
</image>
          `,
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: image,
                },
              },
            ],
          },
        ],
        model: "gpt-4o-mini",
      })
      .then((res) => res.choices.at(0)?.message.content ?? "")
      .catch((e) => {
        console.error(e);
        return "";
      });

    camTaskCount.next(camTaskCount.value - 1);

    return {
      startedAt,
      xml: response,
    };
  }),
  filter((output) => !!output.xml?.length),
  // only keep the latest frame
  scan(
    (acc, curr) => {
      if (curr.startedAt > acc.startedAt) {
        return curr;
      }
      return acc;
    },
    { startedAt: 0, xml: "" },
  ),
  distinctUntilChanged((a, b) => a.xml === b.xml),
  tap((output) => {
    camDescription.textContent = output.xml;
  }),
);

const mergeImage$ = frameChanges$.pipe(
  switchMap((newFrame) => {
    const aoai = llmNode.getClient("aoai");
    const abortController = new AbortController();
    return new Observable((subscriber) => {
      const task = aoai.beta.chat.completions.runTools(
        {
          messages: [
            system`You are a computer vision technician. You are working with an image rendering. It currently loooks like this:
        
\`\`\`xml
${currentSceneXML.value}
\`\`\`

Syntax guideline
- Be hierarchical and efficient. Add details when asked by user.
- Avoid nesting too much. Prefer simple, obvious tag names.
- Use arbitrary xml tags and attributes. Prefer tags over attributes.
  - Use tags to describe subjects, objects, environments and entities.
  - Use attribute to describe un-materialized property of a tag, such as style, material, lighting.
- Use concise natural language where description is needed.
- Spatial relationship must be explicitly described.

The user to capturing the **same** scene from a different angle. Now update the image XML based on the alternative angles provided by the user.
Make sure to incorporate new information into the existing scene XML. You can add or adjust information but do not remove anything occluded in the new angle.
You must use one of the following tools:
- update_by_script tool. You need to pass a DOM manipulate javascript to the tool. 
- rewrite_xml. You must rewrite the entire scene xml.

Use exactly one tool. Do NOT say anything after tool use.
        `,

            user`Image taken from a new angle\n${newFrame.xml}`,
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

camTaskCountDisplay$.subscribe();
frameChanges$.subscribe();
camToggle$.subscribe();
mergeImage$.subscribe();
