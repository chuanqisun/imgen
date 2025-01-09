import { filter, fromEvent, map, Observable, switchMap, tap } from "rxjs";
import type { AzureSttNode } from "../ai-bar/lib/elements/azure-stt-node";
import type { LlmNode } from "../ai-bar/lib/elements/llm-node";
import type { AIBarEventDetail } from "../ai-bar/lib/events";
import { system, user } from "../ai-bar/lib/message";
import { $, preventDefault, stopPropagation } from "../dom";
import { currentWorldXML, rewrite_xml, sttTargetElement, update_by_script } from "./shared";

export function useDictateInput() {
  let submissionQueue: string[] = [];
  const azureSttNode = $<AzureSttNode>("azure-stt-node")!;
  const llmNode = $<LlmNode>("llm-node")!;
  const messageOutput = $<HTMLElement>("#message-output")!;
  const tellPrompt = $<HTMLInputElement>("#tell-prompt")!;

  const voiceSubmit$ = fromEvent<CustomEvent<AIBarEventDetail>>(azureSttNode, "event").pipe(
    tap(preventDefault),
    tap(stopPropagation),
    map((e) => (e as CustomEvent<AIBarEventDetail>).detail.recognized?.text as string),
    filter((v) => !!v?.length),
    filter(() => {
      return tellPrompt === sttTargetElement;
    }),
  );

  const updateWorldModel$ = voiceSubmit$.pipe(
    map((text) => [...submissionQueue, text]),
    switchMap((inputs) => {
      const sceneXML = currentWorldXML.value;
      console.log({ inputs, sceneXML });

      const updateByScript = update_by_script.bind(null, currentWorldXML);
      Object.defineProperty(updateByScript, "name", { value: "update_by_script" }); // protect from bundler mangling
      const rewriteXml = rewrite_xml.bind(null, currentWorldXML);
      Object.defineProperty(rewriteXml, "name", { value: "rewrite_xml" }); // protect from bundler mangling

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

  return updateWorldModel$;
}
