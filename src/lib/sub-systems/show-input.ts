import {
  BehaviorSubject,
  distinctUntilChanged,
  EMPTY,
  filter,
  fromEvent,
  map,
  merge,
  mergeMap,
  Observable,
  scan,
  switchMap,
  tap,
} from "rxjs";
import type { CameraNode } from "../ai-bar/lib/elements/camera-node";
import type { LlmNode } from "../ai-bar/lib/elements/llm-node";
import { system, user } from "../ai-bar/lib/message";
import { $ } from "../dom";
import { currentWorldXML, rewrite_xml, update_by_script } from "./shared";

export function useShowInput() {
  const cameraNode = $<CameraNode>("camera-node")!;
  const cameraPrompt = $<HTMLInputElement>("#camera-prompt")!;
  const camToggle = $<HTMLButtonElement>("#cam-toggle")!;
  const camDescription = $<HTMLDivElement>("#cam-description")!;
  const camTaskCountDisplay = $<HTMLDivElement>("#cam-task-count")!;
  const camCaptureButton = $<HTMLButtonElement>("#cam-capture")!;
  const autoCaptureCheckbox = $<HTMLInputElement>("#auto-capture")!;
  const llmNode = $<LlmNode>("llm-node")!;
  const temporalCheckbox = $<HTMLInputElement>("#temporal-mode")!;

  /** HH:MM:SS */
  const getTimestamp = () => new Date().toTimeString().split(" ")[0];

  const camToggle$ = fromEvent(camToggle, "click").pipe(
    tap((e) => {
      if ((e.target as HTMLButtonElement).textContent === "Start camera") {
        cameraNode.start();
        autoCaptureCheckbox.checked = false;
        camToggle.textContent = "Stop camera";
      } else {
        cameraNode.stop();
        camDescription.textContent = "";
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

  const shouldAutoCap$ = fromEvent(autoCaptureCheckbox, "change").pipe(map(() => autoCaptureCheckbox.checked));
  const autoCap$ = shouldAutoCap$.pipe(
    switchMap((shouldAutoCap) => {
      cameraNode.toggleAttribute("detect-change", shouldAutoCap);

      if (!shouldAutoCap) return EMPTY;
      return fromEvent(cameraNode, "framechange");
    }),
  );

  const manualCap$ = fromEvent(camCaptureButton, "click");

  const camCap$ = merge(autoCap$, manualCap$).pipe(
    map(() => cameraNode.capture()),
    mergeMap(async (image) => {
      const startedAt = Date.now();
      const llm = llmNode.getClient("aoai");
      camTaskCount.next(camTaskCount.value + 1);
      const response = await llm.chat.completions
        .create({
          messages: [
            system`Follow user's instruction and describe the image. Respond with a hierarchical XML scene description. Requirements:

Syntax guideline
- Be hierarchical and efficient
- Avoid nesting too much. Prefer simple, obvious tag names.
- Use arbitrary xml tags and attributes. Prefer tags over attributes.
  - Use tags to describe subjects, objects, environments and entities.
  - Use attribute to describe un-materialized property of a tag, such as style, material, lighting.
- Use concise natural language where description is needed.
- Spatial relationship must be explicitly described.

Respond in XML with top level tags like this:
<scene>...</scene>
          `,
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: cameraPrompt.value.length ? cameraPrompt.value : "Describe the scene.",
                },
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

      const sceneTagPairMultiLinePattern = /<scene>([\s\S]*?)<\/scene>/;
      const sceneTagPairMatch = response.match(sceneTagPairMultiLinePattern);
      const sceneXMLContent = sceneTagPairMatch
        ? `
${temporalCheckbox.checked ? `<scene timestamp="${getTimestamp()}">` : "<scene>"}
${sceneTagPairMatch[1]
  .trim()
  .split("\n")
  .map((line) => `  ${line}`)
  .join("\n")}
</scene>
      `.trim()
        : "";

      return {
        startedAt,
        xml: sceneXMLContent,
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

  const updateWorldModel$ = camCap$.pipe(
    switchMap((newFrame) => {
      const updateByScript = update_by_script.bind(null, currentWorldXML);
      Object.defineProperty(updateByScript, "name", { value: "update_by_script" }); // protect from bundler mangling
      const rewriteXml = rewrite_xml.bind(null, currentWorldXML);
      Object.defineProperty(rewriteXml, "name", { value: "rewrite_xml" }); // protect from bundler mangling

      const aoai = llmNode.getClient("aoai");
      const abortController = new AbortController();
      return new Observable((subscriber) => {
        const task = aoai.beta.chat.completions.runTools(
          {
            messages: [
              system`You are modeling the world based on a series of images captured by a camera. ${temporalCheckbox.checked ? "The series of frames tell a coherent story that unfolds in time." : "The images are captured from different angles, representing different perspectives of the same subject"}
Carefully analyze the incoming image and update the existing world model based on the new information.

Now update the scene XML based on user provided instructions. You must use one of the following tools:
- update_by_script tool. You need to pass a DOM manipulation javascript to the tool. 
- rewrite_xml. You must rewrite the entire scene xml.

${
  temporalCheckbox.checked
    ? `
The updated XML should:
- Focus on verbs, not nouns.
- Reflect the temporal and causal relationship between the frames.
- Tell a coherent story that unfolds in time.
- Preserve previously captured information.
- OK to describe change or motion

Now use the tool to produce a world model like this and say "I'm done":
<world>
  <event timestamp="HH:MM:SS">...</event>
  <event timestamp="HH:MM:SS">...</event>
  ...
</world>
  `.trim()
    : `
The updated XML should:
- Be hierarchical and efficient. Add details when asked by user.
- Avoid nesting too much. Prefer simple, obvious tag names.
- Use arbitrary xml tags and attributes. Prefer tags over attributes.
  - Use tags to describe subjects, objects, environments and entities.
  - Use attribute to describe un-materialized property of a tag, such as style, material, lighting.
- Use concise natural language where description is needed.
- Spatial relationship must be explicitly described.

Now use the tool and say "I'm done".
  `.trim()
}
  `,

              user`
${temporalCheckbox.checked ? "Previous" : "Observed"} world model:
${currentWorldXML.value}

${temporalCheckbox.checked ? "Newer" : "Alternative perspective"} image:
${newFrame.xml}`,
            ],
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
            model: "gpt-4o",
          },
          {
            signal: abortController.signal,
          },
        );

        task
          .finalContent()
          .then((content) => {
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

  return merge(camToggle$, camTaskCountDisplay$, updateWorldModel$);
}
