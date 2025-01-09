import { filter, fromEvent, map, merge, Observable, switchMap, tap } from "rxjs";
import type { AzureSttNode } from "../ai-bar/lib/elements/azure-stt-node";
import { AzureTtsNode } from "../ai-bar/lib/elements/azure-tts-node";
import type { LlmNode } from "../ai-bar/lib/elements/llm-node";
import type { AIBarEventDetail } from "../ai-bar/lib/events";
import { system, user } from "../ai-bar/lib/message";
import { $, preventDefault, stopPropagation } from "../dom";
import { currentWorldXML, rewrite_xml, sttTargetElement, update_by_script } from "./shared";

export function useDefaultInput() {
  let submissionQueue: string[] = [];
  const azureSttNode = $<AzureSttNode>("azure-stt-node")!;
  const azureTssNode = $<AzureTtsNode>("azure-tts-node")!;
  const llmNode = $<LlmNode>("llm-node")!;
  const chatPrompt = $<HTMLInputElement>("#chat-goal-prompt")!;
  const defaultTalkOutput = $<HTMLInputElement>(`#default-talk-transcription`)!;
  const transcriptDisplay = $<HTMLElement>("#chat-transcript")!;
  const startChat = $<HTMLButtonElement>("#start-chat")!;
  let transcript = [] as string[];

  const start$ = fromEvent(startChat, "click").pipe(
    tap(() => {
      transcript = [];
    }),
    map(() => "Let's get started."),
  );

  const recognition$ = fromEvent<CustomEvent<AIBarEventDetail>>(azureSttNode, "event").pipe(
    tap(preventDefault),
    tap(stopPropagation),
    filter(() => sttTargetElement === defaultTalkOutput),
    map((e) => (e as CustomEvent<AIBarEventDetail>).detail.recognized?.text as string),
    filter((v) => !!v?.length),
  );

  const updateWorldModel$ = merge(start$, recognition$).pipe(
    map((text) => {
      submissionQueue.push(text);
      return [...submissionQueue];
    }),
    switchMap((inputs) => {
      const sceneXML = currentWorldXML.value;
      console.log({ inputs, sceneXML });

      const updateByScript = update_by_script.bind(null, currentWorldXML);
      Object.defineProperty(updateByScript, "name", { value: "update_by_script" }); // protect from bundler mangling
      const rewriteXml = rewrite_xml.bind(null, currentWorldXML);
      Object.defineProperty(rewriteXml, "name", { value: "rewrite_xml" }); // protect from bundler mangling

      return new Observable<string>((subscriber) => {
        const llm = llmNode.getClient("aoai");
        const abortController = new AbortController();

        const task = llm.beta.chat.completions.runTools(
          {
            messages: [
              system`
Chat with the user and take notes. The notes is a XML document that models the world.

The goal and format of the chat must be the following:
${chatPrompt.value?.length ? chatPrompt.value : "A casual chat, just to gather facts about things from the user without explicitly asking the user. Prompt the user to keep the conversation going."}
${
  transcript.length
    ? `\nThe conversation transcript so far:
${transcript.join("\n")}
`
    : ""
}
The note you have taken so far:
\`\`\`xml
${sceneXML}         
\`\`\`

Note XML syntax guideline
- Be hierarchical and efficient. Add details when asked by user.
- Avoid nesting too much. Prefer simple, obvious tag names.
- Use arbitrary xml tags and attributes. Prefer tags over attributes.
  - Use tags to describe subjects, objects, environments and entities.
  - Use attribute to describe un-materialized property of a tag, such as style, material, lighting.
- Use concise natural language where description is needed.
- Spatial relationship must be explicitly described.

When you update the note XML, you MUST use one of the following tools:
- update_by_script tool. You need to pass a DOM manipulation javascript to the tool. 
- rewrite_xml. You must rewrite the entire scene xml.

Now, use exactly one tool to take notes, and IMMEDIATELY respond to the user in a short utterance. Always keep the conversation going by prompting user. 
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
                        description: "The new note xml, top level tag must be <world>...</world>",
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
            submissionQueue = submissionQueue.filter((v) => !inputs.includes(v));
            transcript.push(...inputs.map((v) => `User: ${v}`));
            transcript.push(`You: ${content ?? ""}`);
            transcriptDisplay.innerText = transcript.join("\n");
            subscriber.next(content ?? "");
          })
          .catch((e) => console.error(e))
          .finally(() => {
            subscriber.complete();
          });

        return () => abortController.abort();
      });
    }),
  );

  const speak$ = updateWorldModel$.pipe(
    filter((content) => !!content),
    tap((content) => {
      azureTssNode.queue(content);
      console.log(`AI: ${content}`);
    }),
  );

  return speak$;
}
