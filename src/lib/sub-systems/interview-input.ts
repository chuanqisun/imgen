import { fromEvent, map, merge, tap, type BehaviorSubject, type Subscription } from "rxjs";
import { z } from "zod";
import type { OpenAIRealtimeNode } from "../ai-bar/lib/elements/openai-realtime-node";
import { $, parseActionEvent } from "../dom";
import { EMPTY_XML, rewrite_xml, update_by_script } from "./shared";

export function useInterviewInput(options: { currentWorldXML: BehaviorSubject<string> }) {
  const interviewPrompt = $<HTMLInputElement>("#interview-prompt")!;
  const modelPrompt = $<HTMLInputElement>("#model-prompt")!;
  const realtimeNode = $<OpenAIRealtimeNode>("openai-realtime-node")!;
  const toggleInterviewButton = $<HTMLButtonElement>(`[data-action="start-interview"]`)!;
  const realtimePushToTalk = $<HTMLButtonElement>("#realtime-push-to-talk")!;

  let interviewInstructionSub: Subscription | null = null;

  const instructionUpdate$ = options.currentWorldXML.pipe(
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
- Do NOT remove/overwrite the information you have gathered unless user makes a correction. Only add to the model.
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
            run: update_by_script.bind(null, options.currentWorldXML),
          })
          .addDraftTool({
            name: "rewrite_xml",
            description: "Rewrite the entire world xml",
            parameters: z.object({
              xml: z.string().describe("The new scene xml, top level tag must be <world>...</world>"),
            }),
            run: rewrite_xml.bind(null, options.currentWorldXML),
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

  return merge(interviewControl$, interviewPushToTalk$);
}
