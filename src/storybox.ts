import { BehaviorSubject, filter, fromEvent, map, Observable, switchMap, tap, withLatestFrom } from "rxjs";
import { AIBar } from "./lib/ai-bar/lib/ai-bar";
import type { TogetherAINode } from "./lib/ai-bar/lib/elements/together-ai-node";
import { loadAIBar } from "./lib/ai-bar/loader";
import { $, parseActionEvent } from "./lib/dom";

import { LlmNode } from "./lib/ai-bar/lib/elements/llm-node";
import { system, user } from "./lib/ai-bar/lib/message";
import "./storybox.css";

loadAIBar();

const aiBar = $<AIBar>("ai-bar")!;
const llmNode = $<LlmNode>("llm-node")!;
const xmlPreview = $<HTMLElement>("#xml-preview")!;
const togetherAINode = $<TogetherAINode>("together-ai-node")!;
const promptInput = $<HTMLInputElement>("#prompt")!;

const currentSceneXML = new BehaviorSubject("<scene></scene>");

currentSceneXML.pipe(tap((xml) => (xmlPreview.textContent = xml))).subscribe();

const submit$ = fromEvent<KeyboardEvent>(promptInput, "keydown").pipe(
  filter((e) => e.key === "Enter"),
  map((e) => promptInput.value),
  filter((v) => v.length > 0),
  tap(() => (promptInput.value = "")),
);

const updateScene$ = submit$.pipe(withLatestFrom(currentSceneXML)).pipe(
  switchMap(([prompt, sceneXML]) => {
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
- Use arbitrary xml tags and attributes
- Prefer natural language over precise numbers in attribute value.
- Tag inner text can be natural language or other tags.

Now update the scene XML based on user provided instructions. You must use one of the following tools:
- update_by_script tool. You need to pass a DOM manipulate javascript to the tool. 
- rewrite_xml. You must rewrite the entire scene xml.

Use exactly one tool. Do NOT say anything after tool use.
`,
            user`${prompt}`,
          ],
          model: "gpt-4o",
          tools: [
            {
              type: "function",
              function: {
                function: function update_by_script(args: { script: string }) {
                  console.log(`[tool] script`, args.script);
                  const fn = new Function("document", args.script);
                  try {
                    const doc = new DOMParser().parseFromString(sceneXML, "application/xml");
                    fn(doc);
                    const xml = new XMLSerializer().serializeToString(doc);
                    currentSceneXML.next(xml);
                    return `Updated to 
\`\`\`xml
${xml}
\`\`\``.trim();
                  } catch (e) {
                    return `Error: ${(e as any).message}`;
                  }
                },
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
                function: function rewrite_xml(args: { xml: string }) {
                  console.log(`[tool] rewrite`, args.xml);

                  currentSceneXML.next(args.xml);
                  return `Scene XML updated to
\`\`\`xml
${args.xml}
\`\`\`
                  `.trim();
                },
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

      return () => abortController.abort();
    });
  }),
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
